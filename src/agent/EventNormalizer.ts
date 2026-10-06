/**
 * Turns the Agent SDK's message stream into the protocol's events (one normaliser per live
 * query). Keeps the small state this needs: the current run, pending user message ids, tool
 * start times, the task list. Message shapes: see the phase 0 fixtures in spike/fixtures.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEventInput, RunStatus, TodoItem } from '../protocol.js';

export type EmitFn = (event: AgentEventInput, persist?: boolean) => void;
type Rec = Record<string, unknown>;

const TODO_STATUSES = new Set<string>(['pending', 'in_progress', 'completed']);
const isTodoStatus = (s: unknown): s is TodoItem['status'] => typeof s === 'string' && TODO_STATUSES.has(s);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class EventNormalizer {
  private runId: string | null = null;
  private runCounter = 0;
  /**
   * Block ids are `<runId>:<message index>:<block>`. The index counts API messages within a run:
   * `message_start` stream events increment it; `assistant` messages (the SDK emits one per content
   * block, all with the same `message.id`) are mapped to it by id. Streamed text is accumulated
   * per block so the final text block can be matched to it (its content index is always 0).
   */
  private streamMsgIndex = 0;
  private lastAssignedMsgIndex = 0;
  private readonly assistantMsgIndex = new Map<string, number>();
  private readonly streamedText = new Map<string, string>();
  private pendingMessageIds: string[] = [];
  private interruptRequested = false;
  private initEmitted = false;
  private readonly toolStarts = new Map<string, { name: string; startedAt: number }>();
  private readonly tasks = new Map<string, TodoItem>();
  private readonly pendingTaskCreates = new Map<string, { subject: string; activeForm?: string }>();

  /**
   * @param runsSoFar run_start events already in the session's log: run ids continue after them, so
   * a session re-opened after a backend restart does not reuse `r1` (its text would land in the
   * old run's block in the window).
   */
  constructor(
    private readonly emit: EmitFn,
    private readonly runPrefix: string,
    runsSoFar = 0
  ) {
    this.runCounter = runsSoFar;
  }

  get running(): boolean {
    return this.runId !== null;
  }

  get currentRunId(): string | null {
    return this.runId;
  }

  /** A user message was pushed into the live query (before the SDK sees it). */
  noteUserMessage(messageId: string): void {
    this.pendingMessageIds.push(messageId);
  }

  /** The backend called interrupt(): the coming `error_during_execution` result is an interrupt. */
  noteInterrupt(): void {
    this.interruptRequested = true;
  }

  handle(message: SDKMessage): void {
    const m = message as unknown as Rec;
    switch (message.type) {
      case 'system':
        this.onSystem(m);
        break;
      case 'stream_event':
        this.onStream(m);
        break;
      case 'assistant':
        this.onAssistant(m);
        break;
      case 'user':
        this.onUser(m);
        break;
      case 'result':
        this.onResult(m);
        break;
      default:
        break;
    }
  }

  /** The live query ended (closed, process exit or crash). */
  handleExit(error: unknown): void {
    if (error) this.emit({ type: 'error', message: String(error) });
    if (this.runId) this.endRun(error ? 'error' : 'interrupted', { durationMs: 0, turns: 0, costUsd: 0 }, [...this.pendingMessageIds]);
  }

  // --- runs ---------------------------------------------------------------------------------------

  private startRun(trigger: 'user' | 'background_task'): string {
    this.runCounter += 1;
    this.runId = `${this.runPrefix}-r${this.runCounter}`;
    this.streamMsgIndex = 0;
    this.lastAssignedMsgIndex = 0;
    this.assistantMsgIndex.clear();
    this.streamedText.clear();
    this.emit({ type: 'run_start', runId: this.runId, trigger });
    return this.runId;
  }

  private ensureRun(): string {
    return this.runId ?? this.startRun(this.pendingMessageIds.length > 0 ? 'user' : 'background_task');
  }

  private endRun(status: RunStatus, stats: { durationMs: number; turns: number; costUsd: number }, answered: string[]): void {
    if (!this.runId) return;
    this.emit({ type: 'run_end', runId: this.runId, status, answeredMessageIds: answered, ...stats });
    const done = new Set(answered);
    this.pendingMessageIds = this.pendingMessageIds.filter((id) => !done.has(id));
    this.runId = null;
    this.interruptRequested = false;
  }

  // --- SDK message kinds --------------------------------------------------------------------------

  private onSystem(m: Rec): void {
    switch (m.subtype) {
      case 'init': {
        if (!this.initEmitted) {
          this.initEmitted = true;
          this.emit({
            type: 'init',
            model: String(m.model ?? ''),
            tools: strings(m.tools),
            skills: strings(m.skills),
            sdkSessionId: String(m.session_id ?? ''),
            claudeCodeVersion: String(m.claude_code_version ?? '')
          });
        }
        // The SDK emits init at the start of every turn. Before the first message it is a warm-up
        // (no run); after a result with nothing pending it is a follow-up turn of a background task.
        if (this.runId) break;
        if (this.pendingMessageIds.length > 0) this.startRun('user');
        else if (this.runCounter > 0) this.startRun('background_task');
        break;
      }
      case 'status':
        if (m.status === 'requesting') {
          this.ensureRun();
          this.emit({ type: 'status', state: 'requesting' }, false);
        }
        break;
      case 'task_started':
        // A foreground tool call that has been running for a while (backgrounded ones end the turn).
        if (m.is_backgrounded === false && typeof m.tool_use_id === 'string') {
          this.ensureRun();
          this.emit({ type: 'status', state: 'tool_running', toolUseId: m.tool_use_id }, false);
        }
        break;
      default:
        break;
    }
  }

  private onStream(m: Rec): void {
    if (m.parent_tool_use_id) return; // subagent output
    const ev = m.event as Rec | undefined;
    if (!ev) return;
    if (ev.type === 'message_start') {
      this.ensureRun();
      this.streamMsgIndex += 1;
      return;
    }
    if (ev.type === 'content_block_delta') {
      const delta = ev.delta as Rec | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        const runId = this.ensureRun();
        const blockId = `${runId}:${this.streamMsgIndex}:${String(ev.index)}`;
        this.streamedText.set(blockId, (this.streamedText.get(blockId) ?? '') + delta.text);
        this.emit({ type: 'text_delta', runId, blockId, text: delta.text }, false);
      }
    }
  }

  /** Message index of an assistant message: the streamed one when a message_start preceded it, else a new one. */
  private messageIndexOf(messageId: string): number {
    const known = this.assistantMsgIndex.get(messageId);
    if (known !== undefined) return known;
    const index = this.streamMsgIndex > this.lastAssignedMsgIndex ? this.streamMsgIndex : ++this.streamMsgIndex;
    this.lastAssignedMsgIndex = index;
    this.assistantMsgIndex.set(messageId, index);
    return index;
  }

  private onAssistant(m: Rec): void {
    if (m.parent_tool_use_id) return; // subagent output: nested steps are a later feature
    const runId = this.ensureRun();
    const message = (m.message as Rec | undefined) ?? {};
    const msgIndex = this.messageIndexOf(String(message.id ?? m.uuid ?? ''));
    const content = (message.content as Rec[] | undefined) ?? [];
    content.forEach((block, index) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        if (!block.text.trim()) return;
        // The streamed block with the same text (the final block's own index is 0, one block per message).
        const prefix = `${runId}:${msgIndex}:`;
        let blockId = `${prefix}f${index}`;
        for (const [id, streamed] of this.streamedText) {
          if (id.startsWith(prefix) && (streamed === block.text || block.text.startsWith(streamed))) {
            blockId = id;
            this.streamedText.delete(id);
            break;
          }
        }
        this.emit({ type: 'text', runId, blockId, text: block.text });
      } else if (block.type === 'tool_use') {
        this.onToolUse(runId, block);
      }
    });
  }

  private onToolUse(runId: string, block: Rec): void {
    const id = String(block.id);
    const name = String(block.name);
    const input = (block.input ?? {}) as Rec;
    this.toolStarts.set(id, { name, startedAt: Date.now() });
    this.emit({ type: 'tool_start', runId, toolUseId: id, name, label: toolLabel(name, input), input, parentToolUseId: null });

    // Task tools: the list is derived state, emitted in full on every change.
    const activeForm = input.activeForm ?? input.active_form;
    if (name === 'TaskCreate') {
      this.pendingTaskCreates.set(id, { subject: String(input.subject ?? ''), ...(typeof activeForm === 'string' ? { activeForm } : {}) });
    } else if (name === 'TaskUpdate') {
      const taskId = String(input.taskId ?? input.id ?? input.task_id ?? '');
      const task = this.tasks.get(taskId);
      if (taskId && input.status === 'deleted') {
        this.tasks.delete(taskId);
        this.emitTodos(runId);
      } else if (task) {
        if (isTodoStatus(input.status)) task.status = input.status;
        if (typeof activeForm === 'string') task.activeForm = activeForm;
        this.emitTodos(runId);
      }
    } else if (name === 'TodoWrite' && Array.isArray(input.todos)) {
      this.tasks.clear();
      (input.todos as Rec[]).forEach((t, i) => {
        const tid = String(i + 1);
        this.tasks.set(tid, {
          id: tid,
          subject: String(t.content ?? ''),
          status: isTodoStatus(t.status) ? t.status : 'pending',
          ...(typeof t.activeForm === 'string' ? { activeForm: t.activeForm } : {})
        });
      });
      this.emitTodos(runId);
    }
  }

  private emitTodos(runId: string): void {
    this.emit({ type: 'todos', runId, items: [...this.tasks.values()].map((t) => ({ ...t })) });
  }

  private onUser(m: Rec): void {
    if (m.parent_tool_use_id) return;
    const content = (m.message as Rec | undefined)?.content;
    if (!Array.isArray(content)) return; // our own messages are not echoed; synthetic texts are skipped
    for (const block of content as Rec[]) {
      if (block.type !== 'tool_result') continue;
      const id = String(block.tool_use_id);
      const start = this.toolStarts.get(id);
      const runId = this.ensureRun();
      const ok = block.is_error !== true;
      this.emit({ type: 'tool_end', runId, toolUseId: id, ok, summary: resultSummary(block.content), durationMs: start ? Date.now() - start.startedAt : 0 });
      this.toolStarts.delete(id);

      const create = this.pendingTaskCreates.get(id);
      if (create) {
        this.pendingTaskCreates.delete(id);
        const task = (m.tool_use_result as Rec | undefined)?.task as Rec | undefined;
        if (ok && task && task.id != null) {
          const tid = String(task.id);
          this.tasks.set(tid, { id: tid, subject: create.subject, status: 'pending', ...(create.activeForm ? { activeForm: create.activeForm } : {}) });
          this.emitTodos(runId);
        }
      }
    }
  }

  private onResult(m: Rec): void {
    this.ensureRun();
    const subtype = String(m.subtype);
    let status: RunStatus = 'error';
    if (subtype === 'success') status = 'success';
    else if (subtype === 'error_max_turns') status = 'max_turns';
    else if (subtype === 'error_during_execution' && this.interruptRequested) status = 'interrupted';

    // The SDK echoes the uuids of the user messages this turn consumed; fall back to every pending id.
    const echoed = Array.isArray(m.user_message_uuids) ? strings(m.user_message_uuids) : typeof m.user_message_uuid === 'string' ? [m.user_message_uuid] : [];
    const known = echoed.filter((id) => this.pendingMessageIds.includes(id));
    const answered = known.length > 0 ? known : [...this.pendingMessageIds];
    this.endRun(status, { durationMs: num(m.duration_ms), turns: num(m.num_turns), costUsd: num(m.total_cost_usd) }, answered);
    if (status === 'error' && Array.isArray(m.errors) && m.errors.length > 0) this.emit({ type: 'error', message: strings(m.errors).join(' | ') });
  }
}

// --- helpers -------------------------------------------------------------------------------------

const APP_TOOL_PREFIX = 'mcp__asdf10k__';

/**
 * A short human-readable label for a shell command without a description ("Python: degree
 * statistics", "Read selection.tsv"). The prompt asks the agent for a description; this is the
 * fallback, so the step list never shows raw `python -c "..."` one-liners.
 */
export function summarizeCommand(command: string): string {
  const cmd = command.trim();
  if (!cmd) return '';
  const first = cmd.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))?.trim() ?? cmd;
  const words = first.split(/\s+/);
  const prog = (words[0] ?? '').split('/').pop() ?? '';
  const files = words.slice(1).filter((w) => /^[\w./-]+\.[a-z0-9]{1,5}$/i.test(w) && !w.startsWith('-')).map((w) => w.split('/').pop() ?? w);
  const fileList = files.slice(0, 2).join(', ');
  // python: a comment or the imports say what it is about
  if (/^python3?$/.test(prog) || prog === 'uv') {
    const comment = cmd.match(/#\s*([^\n"']{4,80})/)?.[1]?.trim();
    if (comment) return `Python: ${comment}`;
    if (files.length > 0 && !first.includes(' -c ')) return `Run ${fileList}`;
    const topics: string[] = [];
    if (/networkx|nx\./.test(cmd)) topics.push('network analysis');
    if (/matplotlib|plt\./.test(cmd)) topics.push('plot');
    if (/scipy|hypergeom|fisher|ttest|mannwhitney/.test(cmd)) topics.push('statistics');
    if (/value_counts|describe\(|groupby|mean\(|median\(/.test(cmd)) topics.push('summary statistics');
    if (/to_csv|to_tsv|open\([^)]*['"]w/.test(cmd)) topics.push('write file');
    const inputs = [...cmd.matchAll(/input\/(\w+)\.tsv/g)].map((m) => m[1]);
    const about = topics.length ? topics.slice(0, 2).join(' + ') : 'data analysis';
    return `Python: ${about}${inputs.length ? ` of ${[...new Set(inputs)].slice(0, 2).join(' and ')}` : ''}`;
  }
  const verbs: Record<string, string> = { cat: 'Read', head: 'Read', tail: 'Read', less: 'Read', wc: 'Count lines in', ls: 'List', mkdir: 'Create folder', cp: 'Copy', mv: 'Move', rm: 'Delete', grep: 'Search in', rg: 'Search in', cut: 'Read columns of', sort: 'Sort', awk: 'Process', sed: 'Process', echo: 'Write', curl: 'Fetch', wget: 'Fetch', pip: 'Install package', npm: 'npm', node: 'Run', bash: 'Run', sh: 'Run' };
  const verb = verbs[prog];
  if (verb) {
    if (prog === 'ls') return fileList ? `List ${fileList}` : 'List files';
    if ((prog === 'grep' || prog === 'rg') && words[1]) return `Search ${words.slice(1).find((w) => !w.startsWith('-')) ?? ''}${fileList ? ` in ${fileList}` : ''}`.trim();
    if (prog === 'echo') return 'Write text';
    return fileList ? `${verb} ${fileList}` : `${verb} ${words.slice(1).filter((w) => !w.startsWith('-')).slice(0, 2).join(' ')}`.trim();
  }
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

/** Readable one-line name of a tool call for the step list. */
export function toolLabel(name: string, input: Rec): string {
  const s = (v: unknown, n = 70): string => (typeof v === 'string' ? (v.length > n ? `${v.slice(0, n - 1)}…` : v) : '');
  const base = (p: unknown): string => (typeof p === 'string' ? (p.split('/').pop() ?? p) : '');
  switch (name) {
    case 'Bash':
      return s(input.description) || summarizeCommand(typeof input.command === 'string' ? input.command : '') || 'Bash';
    case 'Read':
      return `Read ${base(input.file_path)}`;
    case 'Write':
      return `Write ${base(input.file_path)}`;
    case 'Edit':
      return `Edit ${base(input.file_path)}`;
    case 'Glob':
      return `Find files ${s(input.pattern)}`;
    case 'Grep':
      return `Search ${s(input.pattern)}`;
    case 'WebSearch':
      return `Web search: ${s(input.query)}`;
    case 'WebFetch':
      return `Fetch ${s(input.url)}`;
    case 'Skill':
      return `Skill: ${s(input.skill)}`;
    case 'Task':
      return `Subagent: ${s(input.description)}`;
    case 'TaskCreate':
      return `Task: ${s(input.subject)}`;
    case 'TaskUpdate':
      return `Task ${s(input.taskId ?? input.id ?? input.task_id)}: ${s(input.status)}`;
    case 'TodoWrite':
      return 'Update to-do list';
    case 'ToolSearch':
      return `Tool search: ${s(input.query)}`;
    default:
      return name.startsWith(APP_TOOL_PREFIX) ? name.slice(APP_TOOL_PREFIX.length) : name;
  }
}

/** First ~300 characters of a tool result's text. */
export function resultSummary(content: unknown): string {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = (content as Rec[])
      .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : c.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}
