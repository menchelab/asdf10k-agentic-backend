/**
 * Renders the app catalog (settings, actions, windows, commands the app sent) into the generated
 * skill `asdf10k-app-catalog` of a session workspace, so the agent knows what the app can do and
 * how to name things (plan, phase 4). Rewritten whenever the catalog hash changes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppCatalog, CommandPresentation } from '../protocol.js';
import { presentationOf } from './appCommandPolicy.js';

/** The command heading's note on how the agent uses it (the catalog's `presentation`). */
const PRESENTATION_TEXT: Record<CommandPresentation, string> = { direct: 'you run it', card: 'a card', button: 'a button for the user' };

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
  lines.push('Current values of the main viz settings are in the `<app_context>` block of every message (`viz:`); open windows are listed there as `type#id (options)`. View changes are **cards**, not tool calls: a fenced `asdf10k` block is a change the app applies at once when the user\'s auto-accept is on (the `cards:` line of the app context says; off by default) - the user sees what changed and can Revert; a `cmd:` link to the same command is an offer the user clicks. Never write your own "revert" / "undo" links: every card has Revert.');
  lines.push('');
  lines.push('```asdf10k');
  lines.push('{"type":"settings","label":"Colour by RWR probability, symlog","changes":[{"id":"nodes.colorAttribute","value":"rwr_x_probability_n"},{"id":"nodes.colorMethod","value":"symlog"}]}');
  lines.push('```');
  lines.push('');
  lines.push('```asdf10k');
  lines.push('{"type":"window","label":"Distributions of degree_n for the selection","window":"distribution","config":{"selectedColumn":"degree_n","useGlobal":false}}');
  lines.push('```');
  lines.push('');
  lines.push('```asdf10k');
  lines.push('{"type":"window","label":"Distributions window to the whole graph","id":"popout-distribution","config":{"useGlobal":true}}');
  lines.push('```');
  lines.push('');
  lines.push('`window` with `id` (an open window from the app context) changes that window\'s options (`window.configure`); without `id` it opens a new one (`window.open`). Offers: `[Open Distributions of degree_n](cmd:window.open?type=distribution&selectedColumn=degree_n&useGlobal=false)`, `[Switch to the whole graph](cmd:window.configure?id=popout-distribution&useGlobal=true)`; for a window you open in the same answer (no id yet) use `cmd:window.configure?type=distribution&useGlobal=true` = the most recently opened window of that type.');
  lines.push('');

  lines.push('## Settings');
  lines.push('');
  lines.push('| id | label | category | type | options / range | what it does |');
  lines.push('|---|---|---|---|---|---|');
  for (const s of catalog.settings) {
    let detail = '';
    if (s.type === 'dropdown') detail = (s.options ?? []).map((o) => `\`${o}\``).join(', ');
    else if (s.type === 'number') detail = `${s.min ?? '-inf'} .. ${s.max ?? 'inf'}${s.step ? `, step ${s.step}` : ''}${s.unit ? ` ${s.unit}` : ''}`;
    else detail = 'true / false';
    lines.push(`| \`${s.id}\` | ${s.label} | ${s.category} | ${s.type}${s.readOnly ? ' (read-only)' : ''}${s.scope === 'device' ? ' (this device)' : ''} | ${detail} | ${s.description ?? ''} |`);
  }
  lines.push('');
  if (catalog.settings.some((s) => s.scope === 'device')) {
    lines.push('**(this device)** settings change only the user\'s own device (render, bloom); in a multiplayer session the others keep theirs. Every other setting reaches everyone in the session.');
    lines.push('');
  }
  if (catalog.settings.some((s) => s.readOnly)) {
    lines.push('**Read-only settings** (marked above, the `highlight.*` ids): the **highlight mode** - how the current selection is marked in 3D (bigger nodes, glow, bloom, highlighted edges) and whether everything else fades (`highlight.fadeOthers` + `highlight.fadeOpacity` for nodes, `highlight.fadeEdges` + `highlight.fadeEdgesOpacity` for edges, `highlight.subsetEdgesOnly` = draw only the selection\'s edges, `highlight.edgeSubsetMode` = induced / incident; the user\'s isolate mode (i key) is the same with opacity 0) - stays with the user. `settings.set` refuses these ids and a settings card shows them as manual steps. When such a change would help, read the current values from the `viz:` line of the app context and tell the user what to change where: the Settings window (gear icon in the icon bar) › section "Highlight nodes" or "Edge highlighting" › the label from the table, with the value.');
    lines.push('');
  }
  lines.push('Scaling methods (`*.colorMethod`, `*.sizeMethod`, `*.widthMethod`): `linear` for evenly spread values, `log` for positive skewed values, `symlog` for skewed values that include 0 or negatives (RWR probabilities, scores), `quantile` to rank-spread any distribution.');
  lines.push('');

  lines.push('## Windows (`window` cards; `window.open` / `window.configure` / `window.close` commands)');
  lines.push('');
  lines.push('Options marked **required** must be given (Enrichment, Distributions, Heatmap, Scatter, UpSet and the meta networks need their column - without it the window opens empty and `window.open` refuses). Scope (in brackets after the purpose): most analysis windows have a **G / S toggle** - `global` = all nodes of the graph, `subset` = the current selection (the highlighted nodes; the window follows selection changes unless `frozen`). `[global-or-subset]` windows take `useGlobal` (true = G, false = S; the default is in the option text), `[subset]` windows always show the selection (an empty selection gives an empty window; Enrichment compares the selection with the whole graph as background), `[global]` windows ignore the selection, `[n/a]` windows are tools. When the user asks about "my selection", open the window with `useGlobal=false`; for the whole graph with `useGlobal=true`.');
  lines.push('');
  if (catalog.windows.some((w) => w.options?.some((o) => o.columnKinds))) {
    lines.push('Column options: `column: numeric / normalized` means any **node column** of those kinds (category = `_c`, list = `_a`, key:value = `_kv`, category key:value = `_c_kv`, numeric = `_n`, normalized = `_norm`, text = no suffix) - the columns with their kinds are in the `node columns` list of every message\'s `<app_context>`; `also: label` names the window\'s own built-in columns. `columns` takes a list.');
    lines.push('');
  }
  lines.push('| type | label | purpose | options |');
  lines.push('|---|---|---|---|');
  for (const w of catalog.windows) {
    const options = (w.options ?? []).map((o) => `\`${o.key}\` (${o.required ? 'required ' : ''}${optionDetail(o)})${o.description ? ` - ${o.description}` : ''}`).join('; ');
    lines.push(`| \`${w.type}\` | ${w.label} | ${w.purpose ?? ''} | ${options} |`);
  }
  lines.push('');

  lines.push('## Commands');
  lines.push('');
  lines.push('Effects: each command heading says how you use it. Commands marked "you run it" - `compute` commands, the camera / layout actions (`nav.*`, `layout.*`), `node.activate` (the active node: pulse, Molecular Structure windows), the AR molecule commands (`xr.molecule.*`) - you run with run_app_command; view changes (settings, windows) are cards; `selection` commands (`subset.*`: set, add, expand by one hop, connect, common neighbours, prune leaves, isolate, clear, save to library) and `data` commands are offered to the user as buttons (`cmd:` links, chips, cards). Every action of the app is a command with its own id - there is no menu indirection.');
  lines.push('');
  for (const c of catalog.commands) {
    lines.push(`### \`${c.id}\` - ${c.label} (${c.effect}, ${PRESENTATION_TEXT[presentationOf(c)]})`);
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

/** Column kind -> the words the app context uses for it. */
const KIND_WORDS: Record<string, string> = { categorical: 'category', array: 'list', kv: 'key:value', categorical_kv: 'category key:value' };

/** `column: numeric / category` (protocol 3, by kind; `also:` the built-ins), else the listed values (enums, edge columns, protocol 2). */
function optionDetail(o: NonNullable<AppCatalog['windows'][number]['options']>[number]): string {
  if (o.columnKinds) {
    const kinds = o.columnKinds.map((k) => KIND_WORDS[k] ?? k).join(' / ');
    return `${o.kind}: ${kinds}${o.values?.length ? `; also: ${o.values.join(' / ')}` : ''}`;
  }
  return `${o.kind}${o.values ? `: ${o.values.join(' / ')}` : ''}`;
}

/** Drops the noise from a zod JSON Schema: `$schema`, and `additionalProperties: false` at any depth (the default for the agent). */
function stripSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === '$schema' || (k === 'additionalProperties' && x === false)) continue;
      out[k] = strip(x);
    }
    return out;
  };
  return strip(schema) as Record<string, unknown>;
}

export async function writeCatalogSkill(workspace: string, catalog: AppCatalog): Promise<void> {
  const dir = join(workspace, '.claude', 'skills', CATALOG_SKILL_NAME);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), renderCatalogSkill(catalog));
}
