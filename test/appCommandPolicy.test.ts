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
    { id: 'window.open', label: 'Open a window', description: '', effect: 'view', paramsSchema: {} },
    { id: 'nav.resetView', label: 'Reset view', description: '', effect: 'view', paramsSchema: {} },
    { id: 'subset.set', label: 'Set subset', description: '', effect: 'selection', paramsSchema: {} },
    { id: 'columns.addFromTsv', label: 'Add node columns', description: '', effect: 'data', paramsSchema: {} }
  ]
};

describe('checkAppCommand', () => {
  it('allows compute commands and camera / layout actions', () => {
    expect(checkAppCommand(catalog, 'nav.resetView')).toEqual({ ok: true, label: 'Reset view', effect: 'view' });
    expect(checkAppCommand(catalog, 'rwr.run').ok).toBe(true);
  });
  it('refuses view changes that the app renders as cards', () => {
    const r = checkAppCommand(catalog, 'settings.set');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/write it as a card/);
    expect(checkAppCommand(catalog, 'window.open').ok).toBe(false);
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
