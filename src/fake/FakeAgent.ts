/**
 * Scripted agent for `AGENT_FAKE=1`: no Claude calls. Every message gets a run with the event
 * kinds a real run produces (status, tool steps, to-dos, streamed text, footer), so the window can
 * be built and tested offline.
 */

import type { UUID } from 'node:crypto';
import type { AgentEventInput, TodoItem } from '../protocol.js';
import type { AgentRunner } from '../agent/liveQuery.js';
import type { EmitFn } from '../agent/EventNormalizer.js';

export class FakeAgent implements AgentRunner {
  private timers: NodeJS.Timeout[] = [];
  private runCounter = 0;
  private runId: string | null = null;
  private runStartedAt = 0;
  private pending: string[] = [];

  constructor(private readonly emit: EmitFn) {}

  push(text: string, messageId: UUID): void {
    this.pending.push(messageId);
    if (this.runId) return; // folded into the running turn, like the SDK does

    this.runCounter += 1;
    const runId = `fake-r${this.runCounter}`;
    this.runId = runId;
    this.runStartedAt = Date.now();
    const e = (event: AgentEventInput, persist?: boolean): void => this.emit(event, persist);
    const todos = (a: TodoItem['status'], b: TodoItem['status']): TodoItem[] => [
      { id: '1', subject: 'Look at the question', activeForm: 'Looking at the question', status: a },
      { id: '2', subject: 'Answer', activeForm: 'Answering', status: b }
    ];

    const steps: Array<[number, () => void]> = [];
    let t = 0;
    const at = (ms: number, fn: () => void): void => {
      t += ms;
      steps.push([t, fn]);
    };

    at(0, () => e({ type: 'run_start', runId, trigger: 'user' }));
    at(100, () => e({ type: 'status', state: 'requesting' }, false));
    at(600, () => e({ type: 'tool_start', runId, toolUseId: `${runId}-t1`, name: 'TaskCreate', label: 'Task: Look at the question', input: { subject: 'Look at the question' }, parentToolUseId: null }));
    at(120, () => {
      e({ type: 'tool_end', runId, toolUseId: `${runId}-t1`, ok: true, summary: 'Task #1 created successfully', durationMs: 110 });
      e({ type: 'todos', runId, items: todos('in_progress', 'pending') });
    });
    at(300, () => e({ type: 'tool_start', runId, toolUseId: `${runId}-t2`, name: 'Bash', label: 'Bash: Count the rows of input/nodes.tsv', input: { command: 'wc -l input/nodes.tsv', description: 'Count the rows of input/nodes.tsv' }, parentToolUseId: null }));
    at(1500, () => e({ type: 'tool_end', runId, toolUseId: `${runId}-t2`, ok: true, summary: '264 input/nodes.tsv', durationMs: 1480 }));
    at(100, () => e({ type: 'todos', runId, items: todos('completed', 'in_progress') }));
    at(200, () => e({ type: 'status', state: 'requesting' }, false));

    const asked = text.replace(/^<app_context>[\s\S]*?<\/app_context>\s*/, '');
    const answer = `You asked: *${asked.replace(/[*_`]/g, '').slice(0, 200)}*

This is the **fake agent** (\`AGENT_FAKE=1\`): no Claude call was made. A real run produces the same kinds of events - text streamed as it is written, tool steps, a to-do list and a footer.

| What | Value |
|---|---|
| Nodes | 263 |
| Edges | 317 |

- The selection would be analysed here.
- A plot would be shown as an image card.
`;
    const blockId = `${runId}:1:0`;
    for (const chunk of answer.match(/[\s\S]{1,14}/g) ?? []) at(35, () => e({ type: 'text_delta', runId, blockId, text: chunk }, false));
    at(100, () => e({ type: 'text', runId, blockId, text: answer }));
    at(100, () => e({ type: 'todos', runId, items: todos('completed', 'completed') }));
    at(100, () => this.finish('success'));

    this.timers = steps.map(([ms, fn]) => setTimeout(fn, ms));
  }

  private finish(status: 'success' | 'interrupted'): void {
    const runId = this.runId;
    if (!runId) return;
    this.emit({ type: 'run_end', runId, status, answeredMessageIds: this.pending.splice(0), durationMs: Date.now() - this.runStartedAt, turns: 3, costUsd: 0 });
    this.runId = null;
  }

  async interrupt(): Promise<void> {
    this.clearTimers();
    this.finish('interrupted');
  }

  close(): void {
    this.clearTimers();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
