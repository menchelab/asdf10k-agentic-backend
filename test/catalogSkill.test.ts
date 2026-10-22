import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { paramsSignature, renderCatalogReference, renderCatalogSkill } from '../src/agent/catalogSkill.js';
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
    expect(md).toContain('- `nodes.colorMethod` "Color scaling method" dropdown: linear | log | symlog | quantile');
    expect(md).toContain('- `edges.cutoff` "Edge cutoff" number: 0..1 step 0.01 - hides edges below this weight');
    // read-only: one line of ids and labels; the paragraph says where the user changes them
    expect(md).toContain('- **read-only**: `highlight.fadeOthers` "Fade others"\n');
    expect(md).toContain('- `highlight.bloomMode` "Mode" dropdown **(device)**: always | selection | off');
    expect(md).toContain('**Read-only settings**');
    expect(md).toContain('**(device)** settings');
    expect(md).toContain('G / S toggle');
    expect(md).toContain('{"type":"window","label":"Distributions of degree_n for the selection"');
    expect(md).toContain('- `distribution` "Distributions": histogram of one column [global-or-subset]. Options: selectedColumn (column: degree_n / layer_c); useGlobal (boolean)');
    expect(md).toContain('- `kv-table` "KV table": key:value columns [subset]');
    expect(md).toContain('- `settings.set` { id?: string } (view, card): Sets a viz setting by id');
    // protocol 1 command (no presentation): derived from the effect
    expect(md).toContain('- `rwr.run` {} (compute, run): Runs RWR');
    expect(md).not.toContain('$schema');
    expect(md).toContain('reference.md');
  });

  it('protocol 3: column options by kind with the built-ins, one paragraph on kinds; enums keep values; schema noise dropped', () => {
    const md = renderCatalogSkill({
      ...catalog,
      windows: [{ type: 'subset-table', label: 'Subset table', purpose: 'table [subset]', options: [
        { key: 'selectedAttributes', kind: 'columns', values: ['label'], columnKinds: ['numeric', 'categorical', 'text'] },
        { key: 'sortDir', kind: 'enum', values: ['asc', 'desc'] },
        { key: 'frozen', kind: 'boolean' }
      ] }, { type: 'enrichment', label: 'Enrichment', options: [{ key: 'selectedColumn', kind: 'column', required: true, columnKinds: ['array', 'kv'] }] }],
      commands: [{ id: 'subset.set', label: 'Set', description: 'd', effect: 'selection', paramsSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } }]
    });
    expect(md).toContain('selectedAttributes (columns: numeric / category / text; also: label); sortDir (enum: asc / desc)');
    expect(md).not.toContain('frozen (boolean)'); // the frozen pair is said once, not per window
    expect(md).toContain('selectedColumn* (column: list / key:value)');
    expect(md).toContain('Column options name kinds: `column: numeric / normalized` = any **node column**');
    expect(md).toContain('- `subset.set` { ids?: string[] } (selection, button): d');
    expect(md).not.toContain('additionalProperties');
  });

  it('a protocol-2 catalog (values per column option) still renders the values, without the kinds paragraph', () => {
    const md = renderCatalogSkill(catalog);
    expect(md).toContain('selectedColumn (column: degree_n / layer_c)');
    expect(md).not.toContain('Column options');
  });

  it('N3: a settings dropdown over columns shows its built-ins and the kinds, not every column', () => {
    const md = renderCatalogSkill({ ...catalog, settings: [
      { id: 'nodes.colorAttribute', label: 'Color attribute', category: 'Nodes', type: 'dropdown', options: ['original'], columnKinds: ['numeric', 'categorical'], columnsOf: 'node' },
      { id: 'nodes.sizeAttribute', label: 'Size attribute', category: 'Nodes', type: 'dropdown', options: ['uniform'], columnKinds: ['numeric', 'categorical', 'array', 'kv', 'categorical_kv', 'normalized'], columnsOf: 'node' }
    ] });
    expect(md).toContain('- `nodes.colorAttribute` "Color attribute" dropdown: original | any node column (numeric / category)');
    expect(md).toContain('- `nodes.sizeAttribute` "Size attribute" dropdown: uniform | any node column (any kind but text)');
  });

  it('N3: command params as one-line signatures', () => {
    expect(paramsSignature({ type: 'object', properties: {
      seeds: { type: 'array', items: { type: 'string' } }, alpha: { type: 'number', minimum: 0, maximum: 1 },
      metrics: { anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string', enum: ['flow', 'geoMean'] } }] },
      residue: { anyOf: [{ type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 }, { type: 'null' }] },
      name: { type: 'string', description: 'library name' }
    }, required: ['name'] })).toBe('{ seeds?: string[], alpha?: number 0..1, metrics?: boolean | ("flow" | "geoMean")[], residue?: integer | null, name: string (library name) }');
    expect(paramsSignature({ type: 'object', properties: {} })).toBe('{}');
  });

  it('N3 size: the ppicml catalog (fixture, 2026-10-22) gives a SKILL.md under 17 KB (was 35.9 KB); reference.md keeps every text', () => {
    const real = JSON.parse(readFileSync(new URL('./fixtures/catalog-ppicml.json', import.meta.url), 'utf8')) as AppCatalog;
    const md = renderCatalogSkill(real);
    expect(Buffer.byteLength(md)).toBeLessThan(17_000);
    const ref = renderCatalogReference(real);
    for (const c of real.commands) expect(ref).toContain(c.description);
    for (const s of real.settings) if (s.description) expect(ref).toContain(s.description);
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
