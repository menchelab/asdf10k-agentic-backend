import { describe, expect, it } from 'vitest';
import { renderCatalogSkill } from '../src/agent/catalogSkill.js';
import type { AppCatalog } from '../src/protocol.js';

const catalog: AppCatalog = {
  hash: 'h1',
  settings: [
    { id: 'nodes.colorAttribute', label: 'Color attribute', category: 'Nodes', type: 'dropdown', options: ['original', 'layer_c', 'degree_n'] },
    { id: 'nodes.colorMethod', label: 'Color scaling method', category: 'Nodes', type: 'dropdown', options: ['linear', 'log', 'symlog', 'quantile'] },
    { id: 'edges.cutoff', label: 'Edge cutoff', category: 'Edges', type: 'number', min: 0, max: 1, step: 0.01, description: 'hides edges below this weight' },
    { id: 'highlight.fadeOthers', label: 'Fade others', category: 'Highlight', type: 'toggle' }
  ],
  actions: [{ id: 'subset.expandOneHop', label: 'Expand by one hop', category: 'Subset', effect: 'selection', description: 'adds every neighbour' }],
  windows: [
    { type: 'distribution', label: 'Distributions', purpose: 'histogram of one column [global-or-subset]', options: [{ key: 'selectedColumn', kind: 'column', values: ['degree_n', 'layer_c'] }, { key: 'useGlobal', kind: 'boolean', description: 'true = all nodes (default), false = the current selection' }] },
    { type: 'kv-table', label: 'KV table', purpose: 'key:value columns [subset]' }
  ],
  commands: [{ id: 'settings.set', label: 'Set a setting', description: 'Sets a viz setting by id.', effect: 'view', paramsSchema: { $schema: 'x', type: 'object', properties: { id: { type: 'string' } } } }]
};

describe('renderCatalogSkill', () => {
  it('renders front matter, settings with options and ranges, actions, windows and commands', () => {
    const md = renderCatalogSkill(catalog);
    expect(md.startsWith('---\nname: asdf10k-app-catalog\n')).toBe(true);
    expect(md).toContain('| `nodes.colorMethod` | Color scaling method | Nodes | dropdown | `linear`, `log`, `symlog`, `quantile` |  |');
    expect(md).toContain('| `edges.cutoff` | Edge cutoff | Edges | number | 0 .. 1, step 0.01 | hides edges below this weight |');
    expect(md).toContain('| `highlight.fadeOthers` | Fade others | Highlight | toggle | true / false |  |');
    expect(md).toContain('| `subset.expandOneHop` | Expand by one hop | Subset | selection | adds every neighbour |');
    expect(md).toContain('G / S toggle');
    expect(md).toContain('| `distribution` | Distributions | histogram of one column [global-or-subset] | `selectedColumn` (column: degree_n / layer_c); `useGlobal` (boolean) - true = all nodes (default), false = the current selection |');
    expect(md).toContain('| `kv-table` | KV table | key:value columns [subset] |  |');
    expect(md).toContain('### `settings.set` - Set a setting (view)');
    expect(md).not.toContain('$schema');
  });
});
