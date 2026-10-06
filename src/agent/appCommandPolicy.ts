/**
 * Which app commands the agent may run by itself through `run_app_command` (plan, phase 4):
 * `view` and `compute`. `selection` and `data` commands are offered to the user as buttons.
 */

import type { AppCatalog } from '../protocol.js';

export const DIRECT_EFFECTS: ReadonlySet<string> = new Set(['view', 'compute']);

export type PolicyCheck = { ok: true; label: string; effect: string } | { ok: false; error: string };

export function checkAppCommand(catalog: AppCatalog | null, command: string): PolicyCheck {
  if (!catalog) return { ok: false, error: 'The app has not sent its catalog yet: the user needs to send one message from the Agent window first.' };
  const cmd = catalog.commands.find((c) => c.id === command);
  if (!cmd) return { ok: false, error: `Unknown command "${command}". Commands: ${catalog.commands.map((c) => `${c.id} (${c.effect})`).join(', ')}.` };
  if (!DIRECT_EFFECTS.has(cmd.effect)) {
    return { ok: false, error: `"${command}" changes the ${cmd.effect === 'selection' ? 'selection' : "user's data"}: do not run it yourself, offer it as a button ([label](cmd:${command}?...) or an asdf10k block) and let the user click.` };
  }
  return { ok: true, label: cmd.label, effect: cmd.effect };
}
