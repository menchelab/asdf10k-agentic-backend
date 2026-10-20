/**
 * Which app commands the agent may run by itself through `run_app_command` (plan, phase 4): the
 * catalog says it per command (`presentation`, protocol 2, from the app's command registry):
 * `direct` runs, `card` is a view change written as a change card, `button` (selection, data) is
 * offered to the user. A protocol 1 catalog has no `presentation`: derived from `effect` and the
 * four card commands as before.
 */

import type { AppCatalog, CatalogCommand, CommandPresentation } from '../protocol.js';

const DIRECT_EFFECTS: ReadonlySet<string> = new Set(['view', 'compute']);
/** Protocol 1 only: the view changes the app renders as change cards. */
const CARD_COMMANDS_V1: ReadonlySet<string> = new Set(['settings.set', 'window.open', 'window.configure', 'window.close']);

/** The command's presentation: the catalog's, or derived for a protocol 1 catalog. */
export function presentationOf(cmd: CatalogCommand): CommandPresentation {
  if (cmd.presentation) return cmd.presentation;
  if (CARD_COMMANDS_V1.has(cmd.id)) return 'card';
  return DIRECT_EFFECTS.has(cmd.effect) ? 'direct' : 'button';
}

export type PolicyCheck = { ok: true; label: string; effect: string } | { ok: false; error: string };

export function checkAppCommand(catalog: AppCatalog | null, command: string): PolicyCheck {
  if (!catalog) return { ok: false, error: 'The app has not sent its catalog yet: the user needs to send one message from the Agent window first.' };
  const cmd = catalog.commands.find((c) => c.id === command);
  if (!cmd) {
    if (catalog.settings.some((s) => s.id === command)) return { ok: false, error: `"${command}" is a setting: change it with a settings card ({"type":"settings","changes":[{"id":"${command}","value":...}]}).` };
    return { ok: false, error: `Unknown command "${command}". Commands: ${catalog.commands.map((c) => `${c.id} (${c.effect})`).join(', ')}.` };
  }
  const presentation = presentationOf(cmd);
  if (presentation === 'card') {
    return { ok: false, error: `"${command}" is a view change: do not run it here, write it as a card. A \`\`\`asdf10k block ({"type":"settings",...} or {"type":"window",...}) applies itself when the user's auto-accept is on (the default) and has Revert; a [label](cmd:${command}?...) link offers it as a button. See the skill asdf10k-app.` };
  }
  if (presentation !== 'direct') {
    return { ok: false, error: `"${command}" changes the ${cmd.effect === 'selection' ? 'selection' : "user's data"}: do not run it yourself, offer it as a button ([label](cmd:${command}?...) or an asdf10k block) and let the user click.` };
  }
  return { ok: true, label: cmd.label, effect: cmd.effect };
}
