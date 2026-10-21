/**
 * Sessions on disk (`<SESSIONS_DIR>/<id>/meta.json`, `events.jsonl`, `workspace/`) and the live
 * agent per session: created on the first message, closed after an idle time, resumed by the
 * Claude Code session id on the next message.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config } from '../config.js';
import { EventLog } from './EventLog.js';
import { SessionMetaSchema, type AgentEvent, type AgentEventInput, type SessionMeta } from '../protocol.js';
import { DEFAULT_ASIDE_QUESTION, runAside } from '../agent/aside.js';
import { EventNormalizer } from '../agent/EventNormalizer.js';
import { LiveQuery, type AgentRunner } from '../agent/liveQuery.js';
import { buildAgentOptions } from '../agent/agentOptions.js';
import { composePrompt, renderAppContext, renderUserActions, writeAppInputs } from '../agent/appContext.js';
import { createAppToolsServer } from '../agent/appTools.js';
import { writeCatalogSkill } from '../agent/catalogSkill.js';
import { writeDataDescription } from '../agent/dataDescription.js';
import { FakeAgent } from '../fake/FakeAgent.js';
import { AppCatalogSchema, type AppCatalog, type AppResultRequest, type AppSnapshot } from '../protocol.js';

interface LiveSession {
  runner: AgentRunner;
  normalizer: EventNormalizer | null;
  log: EventLog;
  running: boolean;
  idleTimer: NodeJS.Timeout | null;
  /** Last SDK-driven event (any type): the stall watchdog measures silence from here. */
  lastEventAt: number;
  stallTimer: NodeJS.Timeout | null;
  emit: (event: AgentEventInput, persist?: boolean) => void;
}

/** How long run_app_command waits for the app. */
const APP_REQUEST_TIMEOUT_MS = 120_000;

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`session not found: ${id}`);
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Data rows of a TSV string (header excluded). */
function countRows(tsv: string): number {
  let n = 0;
  for (let i = 0; i < tsv.length; i++) if (tsv.charCodeAt(i) === 10) n++;
  if (tsv.length > 0 && !tsv.endsWith('\n')) n++;
  return Math.max(0, n - 1);
}

export class SessionManager {
  private readonly live = new Map<string, LiveSession>();
  private readonly logs = new Map<string, EventLog>();
  private readonly metas = new Map<string, SessionMeta>();
  /** What the user did with cards / buttons since the last message, per session (prefixed to the next prompt). */
  private readonly feedback = new Map<string, string[]>();
  /** The app catalog per session (also in workspace/input/catalog.json). */
  private readonly catalogs = new Map<string, AppCatalog>();
  /** Open run_app_command requests waiting for the app's answer. */
  private readonly pendingApp = new Map<string, { resolve: (r: AppResultRequest) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  get liveCount(): number {
    return this.live.size;
  }

  sessionDir(id: string): string {
    return join(config.sessionsDir, id);
  }

  workspaceDir(id: string): string {
    return join(this.sessionDir(id), 'workspace');
  }

  /** Creates the sessions dir; runs that were active when the backend stopped are ended in their logs and marked interrupted. */
  async init(): Promise<void> {
    await mkdir(config.sessionsDir, { recursive: true });
    for (const meta of await this.list()) {
      // 'running' = the backend died mid-run; 'interrupted' / 'error' may still hold an open run from an older version
      if (meta.status !== 'running' && meta.status !== 'interrupted' && meta.status !== 'error') continue;
      const ended = await this.endOpenRun(meta.id, 'The backend restarted while the agent was working, so this run stopped. Send your message again - the session and its files are still there.');
      if (ended || meta.status === 'running') await this.saveMeta({ ...meta, status: 'interrupted', updatedAt: Date.now() });
    }
    for (const meta of await this.list()) {
      if (meta.sdkSessionId) continue;
      const recovered = await this.sdkSessionIdFromLog(meta.id);
      if (recovered) await this.updateMeta(meta.id, (m) => ({ ...m, sdkSessionId: recovered }));
    }
  }

  /**
   * Appends an error and a run_end to a session whose log ends in an open run (its agent process is
   * gone: backend restart, crash, stall abort), so windows stop showing a spinner. False when no
   * run was open.
   */
  async endOpenRun(id: string, message: string): Promise<boolean> {
    const log = await this.log(id);
    const events = await log.read(0);
    let open: string | null = null;
    for (const e of events) {
      if (e.type === 'run_start') open = e.runId;
      else if (e.type === 'run_end' && e.runId === open) open = null;
    }
    if (!open) return false;
    log.append({ type: 'error', message });
    log.append({ type: 'run_end', runId: open, status: 'interrupted', answeredMessageIds: [], durationMs: 0, turns: 0, costUsd: 0 });
    return true;
  }

  /** On SIGTERM / SIGINT: tell every running session why it stops, then close the agents. */
  async shutdown(reason: string): Promise<void> {
    for (const [id, session] of [...this.live.entries()]) {
      if (session.running) {
        session.emit({ type: 'error', message: reason });
        session.normalizer?.handleExit(null);
      }
      this.closeLive(id);
    }
  }

  /** "What's up?": asks a fork of the session; the answer is logged as an `aside` event under the current run. */
  async aside(id: string, text = DEFAULT_ASIDE_QUESTION): Promise<{ answer: string }> {
    const meta = await this.get(id);
    if (!meta) throw new NotFoundError(id);
    const log = await this.log(id);
    const runId = this.live.get(id)?.normalizer?.currentRunId ?? null;
    let answer: string;
    if (config.fake) answer = 'Fake agent here: I am pretending to think very hard. Nothing is actually running.';
    else {
      if (!meta.sdkSessionId) throw new Error('this session has no conversation yet');
      answer = await runAside(this.workspaceDir(id), meta.sdkSessionId, text);
    }
    log.append({ type: 'aside', runId, question: text, answer });
    return { answer };
  }

  async list(): Promise<SessionMeta[]> {
    const entries = await readdir(config.sessionsDir, { withFileTypes: true });
    const metas: SessionMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await this.get(entry.name);
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<SessionMeta | null> {
    if (!SAFE_ID.test(id)) return null;
    const cached = this.metas.get(id);
    if (cached) return cached;
    const file = join(this.sessionDir(id), 'meta.json');
    if (!existsSync(file)) return null;
    try {
      const meta = SessionMetaSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      this.metas.set(id, meta);
      return meta;
    } catch {
      return null;
    }
  }

  async create(req: { dataset: string; title?: string | undefined }): Promise<SessionMeta> {
    const now = Date.now();
    const id = `${now.toString(36)}-${randomUUID().slice(0, 8)}`;
    const workspace = this.workspaceDir(id);
    for (const dir of ['input', 'out', '.claude/skills']) await mkdir(join(workspace, dir), { recursive: true });
    const stamp = new Date(now).toLocaleString('sv-SE').slice(0, 16); // local time, "2026-10-06 07:37"
    const meta: SessionMeta = { id, title: req.title ?? `${req.dataset} ${stamp}`, dataset: req.dataset, createdAt: now, updatedAt: now, status: 'idle' };
    await this.saveMeta(meta);
    return meta;
  }

  async delete(id: string): Promise<boolean> {
    const meta = await this.get(id);
    if (!meta) return false;
    this.closeLive(id);
    this.logs.delete(id);
    this.metas.delete(id);
    await rm(this.sessionDir(id), { recursive: true, force: true });
    return true;
  }

  async log(id: string): Promise<EventLog> {
    let log = this.logs.get(id);
    if (!log) {
      log = await EventLog.open(join(this.sessionDir(id), 'events.jsonl'));
      this.logs.set(id, log);
    }
    return log;
  }

  /** The app's graph export -> workspace/input/nodes.tsv + edges.tsv; meta.graphHash tells the app it is there. */
  async setGraph(id: string, graph: { graphHash: string; nodesTsv: string; edgesTsv: string }): Promise<{ graphHash: string; nodes: number; edges: number }> {
    const meta = await this.get(id);
    if (!meta) throw new NotFoundError(id);
    const input = join(this.workspaceDir(id), 'input');
    await mkdir(input, { recursive: true });
    await writeFile(join(input, 'nodes.tsv'), graph.nodesTsv);
    await writeFile(join(input, 'edges.tsv'), graph.edgesTsv);
    await this.updateMeta(id, (m) => ({ ...m, graphHash: graph.graphHash, updatedAt: Date.now() }));
    return { graphHash: graph.graphHash, nodes: countRows(graph.nodesTsv), edges: countRows(graph.edgesTsv) };
  }

  /**
   * Accepts a user message. With a snapshot, the input files are refreshed and the agent gets the
   * `<app_context>` block in front of the text; the event log keeps the text as typed.
   */
  async postMessage(id: string, text: string, snapshot?: AppSnapshot, catalog?: AppCatalog, dataDescription?: { hash: string; text: string }): Promise<{ messageId: string }> {
    const meta = await this.get(id);
    if (!meta) throw new NotFoundError(id);
    // The dataset description is part of the system prompt: written before the agent starts; an idle
    // live agent restarts (resuming the conversation) so this message already sees the new one.
    if (dataDescription && dataDescription.hash !== meta.dataDescriptionHash) {
      await writeDataDescription(this.workspaceDir(id), dataDescription.text);
      await this.updateMeta(id, (m) => ({ ...m, dataDescriptionHash: dataDescription.hash }));
      if (this.live.get(id)?.running === false) this.closeLive(id);
    }
    const session = await this.ensureLive(id, meta);
    // The app's catalog (settings, windows, commands) -> generated skill, rewritten when it changed.
    if (catalog) {
      this.catalogs.set(id, catalog);
      if (catalog.hash !== meta.catalogHash) {
        await writeCatalogSkill(this.workspaceDir(id), catalog);
        await writeFile(join(this.workspaceDir(id), 'input', 'catalog.json'), JSON.stringify(catalog));
        await this.updateMeta(id, (m) => ({ ...m, catalogHash: catalog.hash, updatedAt: Date.now() }));
        await session.runner.reloadSkills?.().catch((e: unknown) => console.warn('[agent] reloadSkills failed', e));
      }
    }
    let prompt = text;
    const userActions = this.feedback.get(id) ?? [];
    this.feedback.delete(id);
    if (snapshot) {
      const previous = await writeAppInputs(this.workspaceDir(id), snapshot);
      let context = renderAppContext(snapshot, previous, userActions);
      if (snapshot.graphHash !== meta.graphHash) {
        context = context.replace(
          '</app_context>',
          `note: the app's graph (hash ${snapshot.graphHash}) is not what was uploaded (${meta.graphHash ?? 'nothing uploaded'}); input/nodes.tsv may be outdated\n</app_context>`
        );
      }
      prompt = composePrompt(text, context);
    } else if (userActions.length > 0) {
      prompt = composePrompt(text, renderUserActions(userActions));
    }
    const messageId = randomUUID();
    session.log.append({ type: 'user_message', messageId, text });
    await this.updateMeta(id, (m) => ({ ...m, updatedAt: Date.now() }));
    session.normalizer?.noteUserMessage(messageId);
    session.runner.push(prompt, messageId);
    this.touch(id, session);
    return { messageId };
  }

  /** The catalog the app last sent (memory, else workspace/input/catalog.json). */
  async getCatalog(id: string): Promise<AppCatalog | null> {
    const cached = this.catalogs.get(id);
    if (cached) return cached;
    const file = join(this.workspaceDir(id), 'input', 'catalog.json');
    if (!existsSync(file)) return null;
    try {
      const catalog = AppCatalogSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      this.catalogs.set(id, catalog);
      return catalog;
    } catch {
      return null;
    }
  }

  /** run_app_command: asks the app (an attached Agent window) to run a command; resolves with its answer. */
  requestApp(id: string, command: string, params: Record<string, unknown>, label: string): Promise<AppResultRequest> {
    const session = this.live.get(id);
    if (!session) return Promise.reject(new Error('no live session'));
    const requestId = randomUUID();
    return new Promise<AppResultRequest>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingApp.delete(requestId);
        reject(new Error(`the app did not answer within ${APP_REQUEST_TIMEOUT_MS / 1000} s - is the Agent window open and connected?`));
      }, APP_REQUEST_TIMEOUT_MS);
      this.pendingApp.set(requestId, { resolve, reject, timer });
      session.emit({ type: 'app_request', requestId, command, params, label }, false);
    });
  }

  /** The app's answer to an app_request; false when the request is unknown (timed out, duplicate). */
  postAppResult(requestId: string, body: AppResultRequest): boolean {
    const pending = this.pendingApp.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingApp.delete(requestId);
    pending.resolve(body);
    return true;
  }

  /** The app reports what the user did with a card / button; logged, and told to the agent with the next message. */
  async postFeedback(id: string, req: { text: string; proposalId?: string | undefined; outcome?: string | undefined; data?: Record<string, unknown> | undefined }): Promise<void> {
    const meta = await this.get(id);
    if (!meta) throw new NotFoundError(id);
    const log = await this.log(id);
    log.append({ type: 'feedback', text: req.text, ...(req.proposalId ? { proposalId: req.proposalId } : {}), ...(req.outcome ? { outcome: req.outcome } : {}), ...(req.data ? { data: req.data } : {}) });
    this.feedback.set(id, [...(this.feedback.get(id) ?? []), req.text]);
  }

  /** Interrupts the current run. Without a live agent, an open run in the log (agent process gone) is ended instead. */
  async interrupt(id: string): Promise<boolean> {
    const session = this.live.get(id);
    if (!session) return this.endOpenRun(id, 'The agent process of this run is gone (backend restart or crash) - the run was stopped. Send your message again.');
    session.normalizer?.noteInterrupt();
    await session.runner.interrupt();
    return true;
  }

  closeAll(): void {
    for (const id of [...this.live.keys()]) this.closeLive(id);
  }

  // --- live agents --------------------------------------------------------------------------------

  private async ensureLive(id: string, meta: SessionMeta): Promise<LiveSession> {
    const existing = this.live.get(id);
    if (existing) return existing;
    const log = await this.log(id);
    const emit = (event: AgentEventInput, persist = true): void => {
      const stored = log.append(event, persist);
      if (stored.type !== 'status') session.lastEventAt = Date.now();
      if (stored.type === 'run_start') {
        session.running = true;
        this.watchStall(id, session);
      }
      if (stored.type === 'run_end') {
        session.running = false;
        if (session.stallTimer) clearInterval(session.stallTimer);
        session.stallTimer = null;
      }
      void this.onEvent(id, stored);
      this.touch(id, session);
    };
    const session: LiveSession = { runner: null as unknown as AgentRunner, normalizer: null, log, running: false, idleTimer: null, lastEventAt: Date.now(), stallTimer: null, emit };
    if (config.fake) {
      session.runner = new FakeAgent(emit, this.workspaceDir(id), id, meta.dataset);
    } else {
      const runsSoFar = (await log.read(0)).filter((e) => e.type === 'run_start').length;
      const normalizer = new EventNormalizer(emit, id.slice(0, 8), runsSoFar);
      session.normalizer = normalizer;
      const tools = createAppToolsServer({
        sessionId: id,
        dataset: meta.dataset,
        workspace: this.workspaceDir(id),
        emit,
        currentRunId: () => normalizer.currentRunId,
        getCatalog: () => this.getCatalog(id),
        requestApp: (command, params, label) => this.requestApp(id, command, params, label)
      });
      session.runner = new LiveQuery(buildAgentOptions(this.workspaceDir(id), meta.sdkSessionId, { asdf10k: tools }), {
        onMessage: (message) => normalizer.handle(message),
        onExit: (error) => {
          normalizer.handleExit(error);
          if (this.live.get(id) === session) {
            if (session.idleTimer) clearTimeout(session.idleTimer);
            this.live.delete(id);
          }
        }
      });
    }
    this.live.set(id, session);
    return session;
  }

  private closeLive(id: string): void {
    const session = this.live.get(id);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    this.live.delete(id);
    session.runner.close();
  }

  /**
   * Stall watchdog for a run: no SDK message for stallWarnMs -> `status: waiting` (the window shows
   * the time without a response); for stallAbortMs -> error event, interrupt, close the agent (its
   * exit ends the run). A hung API request would otherwise spin forever.
   */
  private watchStall(id: string, session: LiveSession): void {
    if (session.stallTimer) clearInterval(session.stallTimer);
    session.lastEventAt = Date.now();
    const check = (): void => {
      if (!session.running || this.live.get(id) !== session) {
        if (session.stallTimer) clearInterval(session.stallTimer);
        session.stallTimer = null;
        return;
      }
      const idleMs = Date.now() - session.lastEventAt;
      if (idleMs >= config.stallAbortMs) {
        if (session.stallTimer) clearInterval(session.stallTimer);
        session.stallTimer = null;
        const min = Math.round(config.stallAbortMs / 60_000);
        session.emit({ type: 'error', message: `No response from the model for ${min} min - the run was stopped. Send your message again (the session continues); if it keeps happening, check the backend log.` });
        void this.abortStalled(id, session);
      } else if (idleMs >= config.stallWarnMs) {
        session.emit({ type: 'status', state: 'waiting', idleMs }, false);
      }
    };
    session.stallTimer = setInterval(check, 15_000);
    session.stallTimer.unref();
  }

  private async abortStalled(id: string, session: LiveSession): Promise<void> {
    session.normalizer?.noteInterrupt();
    await Promise.race([session.runner.interrupt().catch(() => undefined), new Promise((r) => setTimeout(r, 5_000))]);
    if (this.live.get(id) === session) this.closeLive(id); // the agent's exit ends the run (handleExit -> run_end)
  }

  /** Restarts the idle timer; a session is closed when idle for config.idleCloseMs and not running. */
  private touch(id: string, session: LiveSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (session.running) this.touch(id, session);
      else this.closeLive(id);
    }, config.idleCloseMs);
    session.idleTimer.unref();
  }

  private async onEvent(id: string, event: AgentEvent): Promise<void> {
    switch (event.type) {
      case 'init':
        await this.updateMeta(id, (m) => (m.sdkSessionId === event.sdkSessionId ? m : { ...m, sdkSessionId: event.sdkSessionId, updatedAt: Date.now() }));
        break;
      case 'run_start':
        await this.updateMeta(id, (m) => ({ ...m, status: 'running', updatedAt: Date.now() }));
        break;
      case 'run_end':
        await this.updateMeta(id, (m) => ({ ...m, status: event.status === 'success' || event.status === 'max_turns' ? 'idle' : event.status, updatedAt: Date.now() }));
        break;
      default:
        break;
    }
  }

  /** Meta writes of one session run one after another: `init` and `run_start` arrive together and a read-modify-write race dropped the `sdkSessionId` (sessions then resumed without their history). */
  private readonly metaQueues = new Map<string, Promise<void>>();

  private updateMeta(id: string, update: (m: SessionMeta) => SessionMeta): Promise<void> {
    const run = async (): Promise<void> => {
      const meta = await this.get(id);
      if (!meta) return;
      const next = update(meta);
      if (next !== meta) await this.saveMeta(next);
    };
    const queued = (this.metaQueues.get(id) ?? Promise.resolve()).then(run, run);
    this.metaQueues.set(id, queued.catch(() => undefined));
    return queued;
  }

  /** The SDK session id from the log's last `init` event, for metas that lost it to the race above. */
  private async sdkSessionIdFromLog(id: string): Promise<string | undefined> {
    const log = await this.log(id);
    let found: string | undefined;
    for (const e of await log.read(0)) if (e.type === 'init' && e.sdkSessionId) found = e.sdkSessionId;
    return found;
  }

  private async saveMeta(meta: SessionMeta): Promise<void> {
    this.metas.set(meta.id, meta);
    await mkdir(this.sessionDir(meta.id), { recursive: true });
    await writeFile(join(this.sessionDir(meta.id), 'meta.json'), JSON.stringify(meta, null, 2));
  }
}
