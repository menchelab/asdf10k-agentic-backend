/**
 * Scripted agent for `AGENT_FAKE=1`: no Claude calls. Every message gets a run with the event
 * kinds a real run produces (status, tool steps, to-dos, streamed text with an image and action
 * links, a columns proposal, a report), so the window can be built and tested offline. Writes the
 * files the cards point at into the session workspace.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { UUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentEventInput, TodoItem } from '../protocol.js';
import type { AgentRunner } from '../agent/liveQuery.js';
import type { EmitFn } from '../agent/EventNormalizer.js';
import { RunCost } from '../agent/runCost.js';

/** The fake's made-up cost per run (USD), so the window's per-run cost shows offline. */
const FAKE_RUN_COST = 0.012;

const PLOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><rect width="320" height="160" fill="#1b1b1b"/><g fill="#7fc8ff"><rect x="30" y="90" width="40" height="50"/><rect x="90" y="60" width="40" height="80"/><rect x="150" y="30" width="40" height="110"/><rect x="210" y="75" width="40" height="65"/></g><text x="160" y="20" fill="#98fb98" font-family="monospace" font-size="12" text-anchor="middle">fake plot</text></svg>`;

export class FakeAgent implements AgentRunner {
  private timers: NodeJS.Timeout[] = [];
  private runCounter = 0;
  private runId: string | null = null;
  private runStartedAt = 0;
  private pending: string[] = [];
  private fakeTotal = 0;
  private readonly cost = new RunCost();

  constructor(
    private readonly emit: EmitFn,
    private readonly workspace: string,
    private readonly sessionId: string,
    private readonly dataset: string
  ) {}

  /** First node ids of the uploaded graph (phase 2 uploads before the message), or placeholders. */
  private graphIds(n: number): string[] {
    const file = join(this.workspace, 'input', 'nodes.tsv');
    if (!existsSync(file)) return Array.from({ length: n }, (_, i) => `n${i}`);
    return readFileSync(file, 'utf8')
      .split('\n')
      .slice(1)
      .map((l) => l.split('\t')[0] ?? '')
      .filter(Boolean)
      .slice(0, n);
  }

  private writeFiles(ids: string[]): { tsv: string; plot: string; report: string } {
    const out = join(this.workspace, 'out');
    mkdirSync(join(out, 'plots'), { recursive: true });
    mkdirSync(join(out, 'reports'), { recursive: true });
    const tsv = 'out/agent_fake_score.tsv';
    writeFileSync(join(this.workspace, tsv), ['_id\tagent_fake_score_n\tagent_fake_class_c', ...ids.map((id, i) => `${id}\t${(i / Math.max(1, ids.length - 1)).toFixed(3)}\t${i % 2 ? 'odd' : 'even'}`)].join('\n') + '\n');
    const plot = 'out/plots/fake.svg';
    writeFileSync(join(this.workspace, plot), PLOT_SVG);
    const report = 'out/reports/fake-report.md';
    writeFileSync(
      join(this.workspace, report),
      `---
title: Fake report about ${ids.length} nodes
summary: A scripted report from the fake agent, to try the Report and Reports windows offline. Nothing in it is real.
nodes:
${ids
  .slice(0, 6)
  .map((id, i) => `  - { id: ${id}, role: ${['subject', 'evidence', 'candidate', 'context'][i % 4]} }`)
  .join('\n')}
tags: [fake, demo]
---
# Fake report

A table, an image and an action:

| node | score |
|---|---|
${ids
  .slice(0, 3)
  .map((id, i) => `| ${id} | ${(0.3 * (i + 1)).toFixed(1)} |`)
  .join('\n')}

![fake plot](../plots/fake.svg)

[Select the report nodes](cmd:subset.set?ids=${ids.slice(0, 6).join(',')})

\`\`\`mermaid
flowchart LR
  A[selection] --> B[analysis] --> C[report]
\`\`\`
`
    );
    return { tsv, plot, report };
  }

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
    const ids = this.graphIds(20);
    const files = this.writeFiles(ids);

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
    at(300, () => e({ type: 'tool_start', runId, toolUseId: `${runId}-t2`, name: 'Bash', label: 'Count the rows of input/nodes.tsv', input: { command: 'wc -l input/nodes.tsv', description: 'Count the rows of input/nodes.tsv' }, parentToolUseId: null }));
    at(1200, () => e({ type: 'tool_end', runId, toolUseId: `${runId}-t2`, ok: true, summary: '264 input/nodes.tsv', durationMs: 1180 }));
    at(100, () => e({ type: 'todos', runId, items: todos('completed', 'in_progress') }));
    at(200, () => e({ type: 'status', state: 'requesting' }, false));

    const asked = text.replace(/^<app_context>[\s\S]*?<\/app_context>\s*/, '');
    // "/md <markdown>": the answer is that markdown, nothing else (scripted window checks, e2e)
    const scripted = /^\/md\s/.test(asked) ? asked.replace(/^\/md\s/, '') : null;
    if (scripted !== null) {
      const blockId = `${runId}:1:0`;
      at(100, () => e({ type: 'text', runId, blockId, text: scripted }));
      at(100, () => this.finish('success'));
      this.timers = steps.map(([ms, fn]) => setTimeout(fn, ms));
      return;
    }
    const answer = `You asked: *${asked.replace(/[*_`]/g, '').slice(0, 200)}*

This is the **fake agent** (\`AGENT_FAKE=1\`): no Claude call was made. Inline markdown with an image and actions:

![fake plot](${files.plot})

| What | Value |
|---|---|
| Nodes | ${ids.length}+ |
| First id | ${ids[0] ?? '-'} |

[Select the first 5 nodes](cmd:subset.set?ids=${ids.slice(0, 5).join(',')}) · [Save them as "fake five"](cmd:subset.saveToLibrary?name=fake%20five&ids=${ids.slice(0, 5).join(',')}) · [Colour by degree](cmd:settings.set?id=nodes.colorAttribute&value=degree_n)

A window card (applies itself with auto-accept, has Revert):

\`\`\`asdf10k
{"type":"window","label":"Distributions of degree_n for the selection","window":"distribution","config":{"selectedColumn":"degree_n","useGlobal":false}}
\`\`\`

\`\`\`asdf10k
{"type":"settings","label":"Size by degree, quantile scaling","changes":[{"id":"nodes.sizeAttribute","value":"degree_n"},{"id":"nodes.sizeMethod","value":"quantile"}]}
\`\`\`

\`\`\`asdf10k
{"type":"subset","name":"fake ten","description":"the first ten node ids of the upload","ids":${JSON.stringify(ids.slice(0, 10))}}
\`\`\`
`;
    const blockId = `${runId}:1:0`;
    for (const chunk of answer.match(/[\s\S]{1,16}/g) ?? []) at(25, () => e({ type: 'text_delta', runId, blockId, text: chunk }, false));
    at(100, () => e({ type: 'text', runId, blockId, text: answer }));
    at(200, () => e({ type: 'tool_start', runId, toolUseId: `${runId}-t3`, name: 'mcp__asdf10k__propose_node_columns', label: 'propose_node_columns', input: { path: files.tsv }, parentToolUseId: null }));
    at(150, () => {
      e({ type: 'tool_end', runId, toolUseId: `${runId}-t3`, ok: true, summary: 'Shown to the user as a card', durationMs: 140 });
      e({
        type: 'proposal',
        runId,
        proposalId: `${runId}-p1`,
        kind: 'columns',
        summary: 'A fake score (0..1 by row order) and an even/odd class for the first nodes.',
        data: {
          path: files.tsv,
          columns: [
            { name: 'agent_fake_score_n', kind: 'numeric', description: 'row order scaled to 0..1', nonEmpty: ids.length },
            { name: 'agent_fake_class_c', kind: 'categorical', description: 'even / odd row', nonEmpty: ids.length }
          ],
          matched: ids.length,
          total: ids.length,
          header: ['_id', 'agent_fake_score_n', 'agent_fake_class_c'],
          previewRows: ids.slice(0, 3).map((id, i) => [id, (i / Math.max(1, ids.length - 1)).toFixed(3), i % 2 ? 'odd' : 'even'])
        }
      });
    });
    at(200, () => e({ type: 'tool_start', runId, toolUseId: `${runId}-t4`, name: 'mcp__asdf10k__publish_report', label: 'publish_report', input: { path: files.report }, parentToolUseId: null }));
    at(150, () => {
      e({ type: 'tool_end', runId, toolUseId: `${runId}-t4`, ok: true, summary: 'Published', durationMs: 140 });
      e({
        type: 'report',
        runId,
        report: {
          reportId: `${this.sessionId}:fake-report`,
          sessionId: this.sessionId,
          title: `Fake report about ${ids.length} nodes`,
          summary: 'A scripted report from the fake agent, to try the Report and Reports windows offline. Nothing in it is real.',
          dataset: this.dataset,
          nodes: ids.slice(0, 6).map((id, i) => ({ id, role: (['subject', 'evidence', 'candidate', 'context'] as const)[i % 4]! })),
          tags: ['fake', 'demo'],
          markdown: readFileSync(join(this.workspace, files.report), 'utf8').replace(/^---[\s\S]*?---\s*/, ''),
          files: ['../plots/fake.svg'],
          sourcePath: files.report,
          createdAt: Date.now()
        }
      });
    });
    at(100, () => e({ type: 'todos', runId, items: todos('completed', 'completed') }));
    at(100, () => this.finish('success'));

    this.timers = steps.map(([ms, fn]) => setTimeout(fn, ms));
  }

  private finish(status: 'success' | 'interrupted'): void {
    const runId = this.runId;
    if (!runId) return;
    // a made-up SDK running total (FAKE_RUN_COST per run) through the same per-run split as a real session
    this.fakeTotal += FAKE_RUN_COST;
    this.emit({ type: 'run_end', runId, status, answeredMessageIds: this.pending.splice(0), durationMs: Date.now() - this.runStartedAt, turns: 3, ...this.cost.next(this.fakeTotal) });
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
