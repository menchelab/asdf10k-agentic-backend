import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composePrompt, renderAppContext, renderIdFormat, writeAppInputs } from '../src/agent/appContext.js';
import { readGraphIndex } from '../src/agent/graphFiles.js';
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

  it('tells the agent what the user did with cards and buttons', () => {
    const block = renderAppContext(snapshot, null, ['saved subset hubs_2 (12 nodes)', 'added columns agent_x_n']);
    expect(block).toContain('since your last message the user: saved subset hubs_2 (12 nodes); added columns agent_x_n');
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

describe('node id format line', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const graphOf = (rows: string[]): ReturnType<typeof readGraphIndex> => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-'));
    dirs.push(ws);
    mkdirSync(join(ws, 'input'));
    writeFileSync(join(ws, 'input', 'nodes.tsv'), ['_id\tname\tdegree_n', ...rows].join('\n') + '\n');
    return readGraphIndex(ws);
  };

  it('multiplex: id examples and the repeat note', () => {
    const g = graphOf(['HP:MYH7\tMYH7\t3', 'HP:TTN\tTTN\t2', 'coex_HRV:MYH7\tMYH7\t1', 'coex_HRV:TTN\tTTN\t1', 'PPI:MYH7\tMYH7\t5', 'PPI:ACTC1\tACTC1\t4']);
    const line = renderIdFormat(g);
    expect(line).toMatch(/^node ids \(_id\) look like: HP:MYH7, /);
    expect(line).toContain('the name column repeats (3 names on 6 nodes - a name is several copies; selecting a name selects every copy)');
    expect(renderAppContext(snapshot, null, [], g)).toContain(line!);
  });

  it('unique names: examples only, no repeat note; no graph: no line', () => {
    const line = renderIdFormat(graphOf(['A1BG_p\tA1BG\t1', 'C3_p\tC3\t2']));
    expect(line).toBe('node ids (_id) look like: A1BG_p, C3_p');
    expect(renderIdFormat(null)).toBeNull();
    expect(renderAppContext(snapshot, null)).not.toContain('node ids (_id)');
  });
});
