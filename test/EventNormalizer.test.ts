/**
 * The normaliser against the SDK messages recorded in phase 0 (spike/fixtures/*.jsonl).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { EventNormalizer, toolLabel } from '../src/agent/EventNormalizer.js';
import type { AgentEventInput } from '../src/protocol.js';

const fixturesDir = resolve(import.meta.dirname, '../spike/fixtures');

function fixture(filter: (name: string) => boolean): Array<{ tag?: string; at?: number; msg: SDKMessage }> {
  const files = readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.jsonl') && filter(f))
    .sort();
  const file = files[files.length - 1];
  if (!file) throw new Error('no fixture found');
  return readFileSync(resolve(fixturesDir, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { tag?: string; at?: number; msg: SDKMessage });
}

function run(messages: SDKMessage[], before?: (n: EventNormalizer) => void): AgentEventInput[] {
  const events: AgentEventInput[] = [];
  const n = new EventNormalizer((e) => events.push(e), 'test');
  before?.(n);
  for (const m of messages) n.handle(m);
  return events;
}

describe('EventNormalizer on the phase 0 fixture', () => {
  const live = fixture((f) => !f.includes('interrupt'))
    .filter((r) => r.tag === 'live')
    .map((r) => r.msg);

  it('emits one init, one run per SDK result, matching tool start/end pairs', () => {
    const events = run(live, (n) => {
      n.noteUserMessage('m1');
    });
    expect(events.filter((e) => e.type === 'init')).toHaveLength(1);
    const starts = events.filter((e) => e.type === 'run_start');
    const ends = events.filter((e) => e.type === 'run_end');
    const results = live.filter((m) => m.type === 'result').length;
    expect(ends).toHaveLength(results);
    expect(starts).toHaveLength(results);
    expect(ends.every((e) => e.type === 'run_end' && e.status === 'success')).toBe(true);

    const toolStarts = events.filter((e) => e.type === 'tool_start');
    const toolEnds = events.filter((e) => e.type === 'tool_end');
    expect(toolStarts.length).toBeGreaterThan(5);
    expect(toolEnds).toHaveLength(toolStarts.length);
    const ids = new Set(toolStarts.map((e) => (e.type === 'tool_start' ? e.toolUseId : '')));
    for (const e of toolEnds) if (e.type === 'tool_end') expect(ids.has(e.toolUseId)).toBe(true);
  });

  it('marks the follow-up turn after a backgrounded task as background_task', () => {
    const events = run(live, (n) => n.noteUserMessage('m1'));
    const triggers = events.filter((e) => e.type === 'run_start').map((e) => (e.type === 'run_start' ? e.trigger : ''));
    // turns 1-3 were user messages (only the first is noted here, the rest start with no pending id)
    expect(triggers[0]).toBe('user');
    expect(triggers[triggers.length - 1]).toBe('background_task');
  });

  it('builds the to-do list from TaskCreate / TaskUpdate with ids from tool_use_result', () => {
    const events = run(live);
    const todos = events.filter((e) => e.type === 'todos');
    expect(todos.length).toBeGreaterThan(2);
    const last = todos[todos.length - 1];
    if (last?.type !== 'todos') throw new Error('unreachable');
    expect(last.items.map((t) => [t.id, t.subject, t.status])).toEqual([
      ['1', 'count rows', 'completed'],
      ['2', 'report', 'completed']
    ]);
  });

  it('emits streamed text deltas (not persisted) and final text blocks', () => {
    const events: Array<{ e: AgentEventInput; persist: boolean }> = [];
    const n = new EventNormalizer((e, persist = true) => events.push({ e, persist }), 'test');
    for (const m of live) n.handle(m);
    // the spike keeps only the first 40 stream events per run, so the deltas are a sample
    const deltas = events.filter((x) => x.e.type === 'text_delta');
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((x) => !x.persist)).toBe(true);
    const texts = events.filter((x) => x.e.type === 'text');
    expect(texts.every((x) => x.persist)).toBe(true);
    expect(texts.some((x) => x.e.type === 'text' && x.e.text.includes('PELICAN'))).toBe(true);
    // deltas belong to a block that later arrives as final text
    const blockIds = new Set(texts.map((x) => (x.e.type === 'text' ? x.e.blockId : '')));
    expect(deltas.every((x) => x.e.type === 'text_delta' && blockIds.has(x.e.blockId))).toBe(true);
  });
});

describe('EventNormalizer on the interrupt fixture', () => {
  const all = fixture((f) => f.includes('interrupt')).map((r) => r.msg);

  it('maps the result after an interrupt to "interrupted" and answers folded messages together', () => {
    const events = run(all, (n) => {
      n.noteUserMessage('a');
      n.noteInterrupt();
    });
    const ends = events.filter((e) => e.type === 'run_end');
    expect(ends[0]?.type === 'run_end' && ends[0].status).toBe('interrupted');
    expect(ends[0]?.type === 'run_end' && ends[0].answeredMessageIds).toEqual(['a']);
    // the later turns ended normally
    expect(ends.slice(1).every((e) => e.type === 'run_end' && e.status === 'success')).toBe(true);
  });

  it('reports a long-running foreground tool as tool_running status', () => {
    const events = run(all);
    expect(events.some((e) => e.type === 'status' && e.state === 'tool_running')).toBe(true);
  });
});

describe('toolLabel', () => {
  it('gives readable labels', () => {
    expect(toolLabel('Bash', { command: 'ls', description: 'List files' })).toBe('Bash: List files');
    expect(toolLabel('Read', { file_path: '/a/b/nodes.tsv' })).toBe('Read nodes.tsv');
    expect(toolLabel('mcp__asdf10k__show_image', {})).toBe('show_image');
    expect(toolLabel('WebSearch', { query: 'x' })).toBe('Web search: x');
  });
});
