import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composePrompt, renderAppContext, writeAppInputs } from '../src/agent/appContext.js';
import type { AppSnapshot } from '../src/protocol.js';

const snapshot: AppSnapshot = {
  dataset: 'ppicml',
  graphHash: 'abc',
  nodeCount: 263,
  edgeCount: 317,
  nodeColumns: [
    { name: 'degree_n', kind: 'numeric', nonEmpty: 263, origin: 'file', min: 1, max: 55 },
    { name: 'layer_c', kind: 'categorical', nonEmpty: 263, origin: 'file', distinct: 2, topValues: [['protein', 240], ['metabolite', 23]] },
    { name: 'agent_score_n', kind: 'numeric', nonEmpty: 100, origin: 'app', min: 0, max: 1, source: 'agent' }
  ],
  edgeColumns: [{ name: 'edge_type_c', kind: 'categorical', nonEmpty: 317, origin: 'file', distinct: 1, topValues: [['protein-protein', 317]] }],
  layouts: ['default', 'shell_2'],
  currentLayout: 'shell_2',
  nodeColorAttribute: 'layer_c',
  nodeSizeAttribute: 'degree_n',
  selection: { count: 2, ids: ['A1BG_p', 'C3_p'], activeId: 'C3_p' },
  subsetLibrary: [{ name: 'hubs', ids: ['C3_p', 'CR1_p'] }],
  openWindows: [{ type: 'distribution', config: { selectedColumn: 'pathways_a', useGlobal: true } }]
};

describe('renderAppContext', () => {
  it('describes dataset, columns, selection, library and windows in one block', () => {
    const block = renderAppContext(snapshot, null);
    expect(block.startsWith('<app_context>')).toBe(true);
    expect(block).toContain('263 nodes, 317 edges');
    expect(block).toContain('degree_n: numeric, 263/263, 1..55');
    expect(block).toContain('layer_c: category, 263/263, 2 distinct, top: protein 240, metabolite 23');
    expect(block).toContain('*agent_score_n: numeric, 100/263, 0..1, - from agent');
    expect(block).toContain('shell_2 (current)');
    expect(block).toContain('selection: 2 nodes (all ids in input/selection.tsv): A1BG_p, C3_p');
    expect(block).toContain('active node: C3_p');
    expect(block).toContain('hubs (2)');
    expect(block).toContain('distribution (selectedColumn=pathways_a, useGlobal=true)');
    expect(block).not.toContain('since your last message');
  });

  it('reports what changed since the previous snapshot', () => {
    const previous: AppSnapshot = { ...snapshot, graphHash: 'old', nodeColumns: snapshot.nodeColumns.slice(0, 2), selection: { count: 0, ids: [], activeId: null } };
    const block = renderAppContext(snapshot, previous);
    expect(block).toContain('since your last message: the graph files were re-uploaded (new node columns agent_score_n); the selection changed (0 -> 2 nodes)');
  });

  it('composes the prompt with the block first', () => {
    expect(composePrompt('hi', '<app_context>\nx\n</app_context>')).toBe('<app_context>\nx\n</app_context>\n\nhi');
  });
});

describe('writeAppInputs', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('writes the input files and returns the previous snapshot', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-'));
    dirs.push(ws);
    expect(await writeAppInputs(ws, snapshot)).toBeNull();
    expect(readFileSync(join(ws, 'input/selection.tsv'), 'utf8')).toBe('_id\nA1BG_p\nC3_p\n');
    expect(readFileSync(join(ws, 'input/subset_library.tsv'), 'utf8')).toBe('name\tsize\tids\nhubs\t2\tC3_p CR1_p\n');
    const previous = await writeAppInputs(ws, { ...snapshot, graphHash: 'next' });
    expect(previous?.graphHash).toBe('abc');
  });
});
