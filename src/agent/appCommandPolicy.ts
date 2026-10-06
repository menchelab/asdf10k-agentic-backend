/**
 * Which app commands the agent may run by itself through `run_app_command` (plan, phase 4):
 * `view` and `compute`. `selection` and `data` commands are offered to the user as buttons.
 */

import type { AppCatalog } from '../protocol.js';

export const DIRECT_EFFECTS: ReadonlySet<string> = new Set(['view', 'compute']);
/** View changes the app renders as change cards (apply themselves with auto-accept, have Revert): never run through the tool. */
export const CARD_COMMANDS: ReadonlySet<string> = new Set(['settings.set', 'window.open', 'window.configure', 'window.close']);

export type PolicyCheck = { ok: true; label: string; effect: string } | { ok: false; error: string };

export function checkAppCommand(catalog: AppCatalog | null, command: string): PolicyCheck {
  if (!catalog) return { ok: false, error: 'The app has not sent its catalog yet: the user needs to send one message from the Agent window first.' };
  const cmd = catalog.commands.find((c) => c.id === command);
  if (!cmd) {
    // a ring menu id used as a command: say how it runs
    if (catalog.actions.some((a) => a.id === command)) {
      return { ok: false, error: `"${command}" is a menu entry, not a command; the commands are listed in the skill asdf10k-app-catalog.` };
    }
    if (catalog.settings.some((s) => s.id === command)) return { ok: false, error: `"${command}" is a setting: change it with a settings card ({"type":"settings","changes":[{"id":"${command}","value":...}]}).` };
    return { ok: false, error: `Unknown command "${command}". Commands: ${catalog.commands.map((c) => `${c.id} (${c.effect})`).join(', ')}.` };
  }
  if (CARD_COMMANDS.has(command)) {
    return { ok: false, error: `"${command}" is a view change: do not run it here, write it as a card. A \`\`\`asdf10k block ({"type":"settings",...} or {"type":"window",...}) applies itself when the user's auto-accept is on (the default) and has Revert; a [label](cmd:${command}?...) link offers it as a button. See the skill asdf10k-app.` };
  }
  if (!DIRECT_EFFECTS.has(cmd.effect)) {
    return { ok: false, error: `"${command}" changes the ${cmd.effect === 'selection' ? 'selection' : "user's data"}: do not run it yourself, offer it as a button ([label](cmd:${command}?...) or an asdf10k block) and let the user click.` };
  }
  return { ok: true, label: cmd.label, effect: cmd.effect };
}
