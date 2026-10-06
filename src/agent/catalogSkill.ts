/**
 * Renders the app catalog (settings, actions, windows, commands the app sent) into the generated
 * skill `asdf10k-app-catalog` of a session workspace, so the agent knows what the app can do and
 * how to name things (plan, phase 4). Rewritten whenever the catalog hash changes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppCatalog } from '../protocol.js';

export const CATALOG_SKILL_NAME = 'asdf10k-app-catalog';

export function renderCatalogSkill(catalog: AppCatalog): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${CATALOG_SKILL_NAME}`);
  lines.push('description: Generated list of what the asdf10k app can do right now - every viz setting with its options (colour / size attributes, scaling methods, edges, highlight, layout), the subset actions, the windows and their purpose, and the commands with their parameters. Use when choosing a setting value, suggesting a window, or writing a cmd: link / asdf10k block.');
  lines.push('---');
  lines.push('');
  lines.push('# App catalog (generated)');
  lines.push('');
  lines.push('Current values of the main viz settings are in the `<app_context>` block of every message (`viz:`). Change a setting with the `settings.set` command (`id`, `value`); suggest several at once with a settings card:');
  lines.push('');
  lines.push('```asdf10k');
  lines.push('{"type":"settings","label":"Colour by RWR probability, symlog","changes":[{"id":"nodes.colorAttribute","value":"rwr_x_probability_n"},{"id":"nodes.colorMethod","value":"symlog"}]}');
  lines.push('```');
  lines.push('');

  lines.push('## Settings');
  lines.push('');
  lines.push('| id | label | category | type | options / range |');
  lines.push('|---|---|---|---|---|');
  for (const s of catalog.settings) {
    let detail = '';
    if (s.type === 'dropdown') detail = (s.options ?? []).map((o) => `\`${o}\``).join(', ');
    else if (s.type === 'number') detail = `${s.min ?? '-inf'} .. ${s.max ?? 'inf'}${s.step ? `, step ${s.step}` : ''}${s.unit ? ` ${s.unit}` : ''}`;
    else detail = 'true / false';
    lines.push(`| \`${s.id}\` | ${s.label} | ${s.category} | ${s.type} | ${detail} |`);
  }
  lines.push('');
  lines.push('Scaling methods (`*.colorMethod`, `*.sizeMethod`, `*.widthMethod`): `linear` for evenly spread values, `log` for positive skewed values, `symlog` for skewed values that include 0 or negatives (RWR probabilities, scores), `quantile` to rank-spread any distribution.');
  lines.push('');

  if (catalog.actions.length > 0) {
    lines.push('## Actions (`menu.run` for view actions, `subset.action` for subset actions)');
    lines.push('');
    lines.push('| id | label | category | effect |');
    lines.push('|---|---|---|---|');
    for (const a of catalog.actions) lines.push(`| \`${a.id}\` | ${a.label} | ${a.category} | ${a.effect} |`);
    lines.push('');
  }

  lines.push('## Windows (`window.open`, or a `cmd:window.open?type=...` link)');
  lines.push('');
  lines.push('| type | label | purpose | options |');
  lines.push('|---|---|---|---|');
  for (const w of catalog.windows) {
    const options = (w.options ?? []).map((o) => `\`${o.key}\` (${o.kind}${o.values ? `: ${o.values.join(' / ')}` : ''})${o.description ? ` - ${o.description}` : ''}`).join('; ');
    lines.push(`| \`${w.type}\` | ${w.label} | ${w.purpose ?? ''} | ${options} |`);
  }
  lines.push('');

  lines.push('## Commands');
  lines.push('');
  lines.push('Effects: `view` and `compute` commands may be run by you (run_app_command, when available); `selection` and `data` commands are offered to the user as buttons (`cmd:` links, cards).');
  lines.push('');
  for (const c of catalog.commands) {
    lines.push(`### \`${c.id}\` - ${c.label} (${c.effect})`);
    lines.push('');
    lines.push(c.description);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(stripSchema(c.paramsSchema), null, 1));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

/** Drops the `$schema` noise from a zod JSON Schema. */
function stripSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _s, ...rest } = schema;
  return rest;
}

export async function writeCatalogSkill(workspace: string, catalog: AppCatalog): Promise<void> {
  const dir = join(workspace, '.claude', 'skills', CATALOG_SKILL_NAME);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), renderCatalogSkill(catalog));
}
