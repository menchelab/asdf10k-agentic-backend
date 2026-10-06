import { describe, expect, it } from 'vitest';
import { checkAppCommand } from '../src/agent/appCommandPolicy.js';
import type { AppCatalog } from '../src/protocol.js';

const catalog: AppCatalog = {
  hash: 'h',
  settings: [],
  actions: [],
  windows: [],
  commands: [
    { id: 'settings.set', label: 'Set a viz setting', description: '', effect: 'view', paramsSchema: {} },
    { id: 'rwr.run', label: 'Random walk with restart', description: '', effect: 'compute', paramsSchema: {} },
    { id: 'subset.set', label: 'Set subset', description: '', effect: 'selection', paramsSchema: {} },
    { id: 'columns.addFromTsv', label: 'Add node columns', description: '', effect: 'data', paramsSchema: {} }
  ]
};

describe('checkAppCommand', () => {
  it('allows view and compute commands', () => {
    expect(checkAppCommand(catalog, 'settings.set')).toEqual({ ok: true, label: 'Set a viz setting', effect: 'view' });
    expect(checkAppCommand(catalog, 'rwr.run').ok).toBe(true);
  });
  it('refuses selection and data commands with a hint, and unknown commands with the list', () => {
    const sel = checkAppCommand(catalog, 'subset.set');
    expect(sel.ok).toBe(false);
    expect(sel.ok === false && sel.error).toMatch(/offer it as a button/);
    expect(checkAppCommand(catalog, 'columns.addFromTsv').ok).toBe(false);
    const unknown = checkAppCommand(catalog, 'nope.run');
    expect(unknown.ok === false && unknown.error).toMatch(/Commands: settings.set \(view\)/);
  });
  it('needs a catalog', () => {
    expect(checkAppCommand(null, 'rwr.run').ok).toBe(false);
  });
});
