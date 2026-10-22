import { describe, expect, it } from 'vitest';
import { renderCatalogSkill } from '../src/agent/catalogSkill.js';
import type { AppCatalog } from '../src/protocol.js';

const catalog: AppCatalog = {
  hash: 'h1',
  settings: [
    { id: 'nodes.colorAttribute', label: 'Color attribute', category: 'Nodes', type: 'dropdown', options: ['original', 'layer_c', 'degree_n'] },
    { id: 'nodes.colorMethod', label: 'Color scaling method', category: 'Nodes', type: 'dropdown', options: ['linear', 'log', 'symlog', 'quantile'] },
    { id: 'edges.cutoff', label: 'Edge cutoff', category: 'Edges', type: 'number', min: 0, max: 1, step: 0.01, description: 'hides edges below this weight' },
    { id: 'highlight.fadeOthers', label: 'Fade others', category: 'Highlight', type: 'toggle', readOnly: true, description: 'dim the others; the user changes it: Settings window › Highlight nodes' },
    { id: 'highlight.bloomMode', label: 'Mode', category: 'Highlight', type: 'dropdown', options: ['always', 'selection', 'off'], scope: 'device' }
  ],
  windows: [
    { type: 'distribution', label: 'Distributions', purpose: 'histogram of one column [global-or-subset]', options: [{ key: 'selectedColumn', kind: 'column', values: ['degree_n', 'layer_c'] }, { key: 'useGlobal', kind: 'boolean', description: 'true = all nodes (default), false = the current selection' }] },
    { type: 'kv-table', label: 'KV table', purpose: 'key:value columns [subset]' }
  ],
  commands: [
    { id: 'settings.set', label: 'Set a setting', description: 'Sets a viz setting by id.', effect: 'view', presentation: 'card', paramsSchema: { $schema: 'x', type: 'object', properties: { id: { type: 'string' } } } },
    { id: 'rwr.run', label: 'Random walk', description: 'Runs RWR.', effect: 'compute', paramsSchema: {} }
  ]
};

describe('renderCatalogSkill', () => {
  it('renders front matter, settings with options, ranges and scope, windows and commands with their presentation', () => {
    const md = renderCatalogSkill(catalog);
    expect(md.startsWith('---\nname: asdf10k-app-catalog\n')).toBe(true);
    expect(md).toContain('| `nodes.colorMethod` | Color scaling method | Nodes | dropdown | `linear`, `log`, `symlog`, `quantile` |  |');
    expect(md).toContain('| `edges.cutoff` | Edge cutoff | Edges | number | 0 .. 1, step 0.01 | hides edges below this weight |');
    expect(md).toContain('| `highlight.fadeOthers` | Fade others | Highlight | toggle (read-only) | true / false | dim the others; the user changes it: Settings window › Highlight nodes |');
    expect(md).toContain('**Read-only settings**');
    expect(md).toContain('| `highlight.bloomMode` | Mode | Highlight | dropdown (this device) |');
    expect(md).toContain('**(this device)** settings');
    expect(md).not.toContain('Ring menu actions');
    expect(md).toContain('G / S toggle');
    expect(md).toContain('{"type":"window","label":"Distributions of degree_n for the selection"');
    expect(md).toContain('| `distribution` | Distributions | histogram of one column [global-or-subset] | `selectedColumn` (column: degree_n / layer_c); `useGlobal` (boolean) - true = all nodes (default), false = the current selection |');
    expect(md).toContain('| `kv-table` | KV table | key:value columns [subset] |  |');
    expect(md).toContain('### `settings.set` - Set a setting (view, a card)');
    // protocol 1 command (no presentation): derived from the effect
    expect(md).toContain('### `rwr.run` - Random walk (compute, you run it)');
    expect(md).not.toContain('$schema');
  });

  it('protocol 3: column options by kind with the built-ins, one paragraph on kinds; enums keep values; schema noise dropped', () => {
    const md = renderCatalogSkill({
      ...catalog,
      windows: [{ type: 'subset-table', label: 'Subset table', purpose: 'table [subset]', options: [
        { key: 'selectedAttributes', kind: 'columns', values: ['label'], columnKinds: ['numeric', 'categorical', 'text'] },
        { key: 'sortDir', kind: 'enum', values: ['asc', 'desc'] }
      ] }, { type: 'enrichment', label: 'Enrichment', options: [{ key: 'selectedColumn', kind: 'column', required: true, columnKinds: ['array', 'kv'] }] }],
      commands: [{ id: 'subset.set', label: 'Set', description: 'd', effect: 'selection', paramsSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } }]
    });
    expect(md).toContain('`selectedAttributes` (columns: numeric / category / text; also: label); `sortDir` (enum: asc / desc)');
    expect(md).toContain('`selectedColumn` (required column: list / key:value)');
    expect(md).toContain('Column options: `column: numeric / normalized` means any **node column**');
    expect(md).not.toContain('additionalProperties');
  });

  it('a protocol-2 catalog (values per column option) still renders the values, without the kinds paragraph', () => {
    const md = renderCatalogSkill(catalog);
    expect(md).toContain('`selectedColumn` (column: degree_n / layer_c)');
    expect(md).not.toContain('Column options:');
  });

  it('size: 15 windows over 300 columns stay small by kind (protocol 3), not per value (protocol 2)', () => {
    const columns = Array.from({ length: 300 }, (_, i) => `column_number_${i}_n`);
    const win = (i: number, p3: boolean): AppCatalog['windows'][number] => ({
      type: `w${i}`, label: `Window ${i}`, purpose: 'something [global-or-subset]',
      options: [0, 1, 2].map((k) => (p3 ? { key: `col${k}`, kind: 'column', columnKinds: ['numeric', 'normalized'] } : { key: `col${k}`, kind: 'column', values: columns }))
    });
    const size = (p3: boolean): number => renderCatalogSkill({ ...catalog, windows: Array.from({ length: 15 }, (_, i) => win(i, p3)) }).length;
    expect(size(true)).toBeLessThan(15_000);
    expect(size(false)).toBeGreaterThan(200_000);
  });
});
