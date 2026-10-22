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
/** The same, short (SKILL.md; the legend is above the list). */
const PRESENTATION_SHORT: Record<CommandPresentation, string> = { direct: 'run', card: 'card', button: 'button' };

export const CATALOG_SKILL_NAME = 'asdf10k-app-catalog';

/** The file beside SKILL.md with the full texts (finding N3: SKILL.md stays an index, under ~15 KB). */
export const CATALOG_REFERENCE_FILE = 'reference.md';

/** The first sentence of a description, at most `max` characters (SKILL.md; the full text is in reference.md). */
export function shortText(text: string | undefined, max: number): string {
  if (!text) return '';
  const first = text.split(/(?<=[a-z0-9)"'`])\. (?=[A-Z(`"])/)[0]!.replace(/\.$/, '');
  return first.length <= max ? first : `${first.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** SKILL.md: the index the agent loads - ids, options, signatures, one short line each. */
export function renderCatalogSkill(catalog: AppCatalog): string {
  return render(catalog, false);
}

/** reference.md: the same with every setting note, window option text and command description in full. */
export function renderCatalogReference(catalog: AppCatalog): string {
  return render(catalog, true);
}

function render(catalog: AppCatalog, full: boolean): string {
  const lines: string[] = [];
  if (full) {
    lines.push('# App catalog: full reference (generated)');
    lines.push('');
    lines.push('The full texts behind SKILL.md of the asdf10k-app-catalog skill. Grep it for an id.');
    lines.push('');
    renderBody(catalog, lines, true);
    return lines.join('\n');
  }
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
  lines.push(`Short lines only here; the full notes, option texts and command descriptions are in \`${CATALOG_REFERENCE_FILE}\` next to this file (grep it for an id).`);
  lines.push('');
  renderBody(catalog, lines, false);
  return lines.join('\n');
}

function renderBody(catalog: AppCatalog, lines: string[], full: boolean): void {
  const say = (text: string | undefined, max: number): string => (full ? text ?? '' : shortText(text, max));
  lines.push('## Settings');
  lines.push('');
  lines.push('`id` "label" type: options or range - what it does. **(device)** = this device only, **(read-only)** = the user changes it.');
  // one line per setting, grouped by category (N3: a table with a column per field was the bigger form)
  for (const category of [...new Set(catalog.settings.map((x) => x.category))]) {
    lines.push('');
    lines.push(`### ${category}`);
    const inCategory = catalog.settings.filter((x) => x.category === category);
    // SKILL.md: the read-only ones (you never set them) as one line of ids and labels
    const readOnly = full ? [] : inCategory.filter((x) => x.readOnly);
    if (readOnly.length) lines.push(`- **read-only**: ${readOnly.map((x) => `\`${x.id}\` "${x.label}"${x.scope === 'device' ? ' (device)' : ''}`).join(', ')}`);
    for (const s of inCategory.filter((x) => full || !x.readOnly)) {
      let detail = '';
      if (s.type === 'dropdown') {
        // a dropdown over columns: its built-ins and the kinds (N3; the columns are in the app context)
        const listed = (s.options ?? []).join(' | ');
        detail = s.columnKinds?.length ? `${listed}${listed ? ' | ' : ''}any ${s.columnsOf ?? 'node'} column (${kindsText(s.columnKinds)})` : listed;
      } else if (s.type === 'number') detail = `${s.min ?? '-inf'}..${s.max ?? 'inf'}${s.step ? ` step ${s.step}` : ''}${s.unit ? ` ${s.unit}` : ''}`;
      else detail = 'true | false';
      const flags = `${s.readOnly ? ' **(read-only)**' : ''}${s.scope === 'device' ? ' **(device)**' : ''}`;
      // a read-only setting's note ends with where the user changes it: the paragraph below says that once
      const what = full ? s.description ?? '' : s.readOnly ? '' : say(s.description, 60);
      lines.push(`- \`${s.id}\` "${s.label}" ${s.type}${flags}: ${detail}${what ? ` - ${what}` : ''}`);
    }
  }
  lines.push('');
  if (catalog.settings.some((s) => s.scope === 'device')) {
    lines.push('**(device)** settings change only the user\'s own device (render, bloom); in a multiplayer session the others keep theirs. Every other setting reaches everyone in the session.');
    lines.push('');
  }
  if (catalog.settings.some((s) => s.readOnly) && !full) {
    lines.push('**Read-only settings** (`highlight.*`, the highlight mode: how the selection is marked, fading the others): `settings.set` refuses them; tell the user what to change where - Settings window (gear icon) › "Highlight nodes" or "Edge highlighting" › the label, with the value.');
    lines.push('');
  }
  if (catalog.settings.some((s) => s.readOnly) && full) {
    lines.push('**Read-only settings** (marked above, the `highlight.*` ids): the **highlight mode** - how the current selection is marked in 3D (bigger nodes, glow, bloom, highlighted edges) and whether everything else fades (`highlight.fadeOthers` + `highlight.fadeOpacity` for nodes, `highlight.fadeEdges` + `highlight.fadeEdgesOpacity` for edges, `highlight.subsetEdgesOnly` = draw only the selection\'s edges, `highlight.edgeSubsetMode` = induced / incident; the user\'s isolate mode (i key) is the same with opacity 0) - stays with the user. `settings.set` refuses these ids and a settings card shows them as manual steps. When such a change would help, read the current values from the `viz:` line of the app context and tell the user what to change where: the Settings window (gear icon in the icon bar) › section "Highlight nodes" or "Edge highlighting" › the label from the table, with the value.');
    lines.push('');
  }
  lines.push('Scaling methods (`*.colorMethod`, `*.sizeMethod`, `*.widthMethod`): `linear` for evenly spread values, `log` for positive skewed values, `symlog` for skewed values that include 0 or negatives (RWR probabilities, scores), `quantile` to rank-spread any distribution.');
  lines.push('');

  lines.push('## Windows (`window` cards; `window.open` / `window.configure` / `window.close` commands)');
  lines.push('');
  if (!full) lines.push('**required** options (`*` after the key) must be given (else the window opens empty and `window.open` refuses). Scope after the purpose: `[global-or-subset]` = a G / S toggle, `useGlobal` true = all nodes, false = the selection (the user\'s "my selection" → false); `[subset]` = always the selection (Enrichment against the whole graph); `[global]` ignores the selection; `[n/a]` = a tool.');
  else lines.push('Options marked **required** must be given (Enrichment, Distributions, Heatmap, Scatter, UpSet and the meta networks need their column - without it the window opens empty and `window.open` refuses). Scope (in brackets after the purpose): most analysis windows have a **G / S toggle** - `global` = all nodes of the graph, `subset` = the current selection (the highlighted nodes; the window follows selection changes unless `frozen`). `[global-or-subset]` windows take `useGlobal` (true = G, false = S; the default is in the option text), `[subset]` windows always show the selection (an empty selection gives an empty window; Enrichment compares the selection with the whole graph as background), `[global]` windows ignore the selection, `[n/a]` windows are tools. When the user asks about "my selection", open the window with `useGlobal=false`; for the whole graph with `useGlobal=true`.');
  lines.push('');
  if (catalog.windows.some((w) => w.options?.some((o) => o.columnKinds))) {
    if (!full) lines.push('Most windows also take `frozen` (true = keep the nodes shown at open time) and `frozenIds`; the reference lists them.');
    if (!full) lines.push('Column options name kinds: `column: numeric / normalized` = any **node column** of those kinds (category `_c`, list `_a`, key:value `_kv`, category key:value `_c_kv`, numeric `_n`, normalized `_norm`, text = no suffix; the columns are in `<app_context>`); `also:` = the window\'s built-ins; `columns` = a list.');
    else lines.push('Column options: `column: numeric / normalized` means any **node column** of those kinds (category = `_c`, list = `_a`, key:value = `_kv`, category key:value = `_c_kv`, numeric = `_n`, normalized = `_norm`, text = no suffix) - the columns with their kinds are in the `node columns` list of every message\'s `<app_context>`; `also: label` names the window\'s own built-in columns. `columns` takes a list.');
    lines.push('');
  }
  for (const w of catalog.windows) {
    const sameAs = (values: string[]): string | undefined => {
      const key = values.join('\n');
      const hit = catalog.settings.find((x) => (x.options ?? []).filter((v) => v !== '__CUSTOM__').join('\n') === key || (x.options ?? []).join('\n') === key);
      return hit ? `\`${hit.id}\`` : undefined;
    };
    // SKILL.md leaves out the frozen pair most windows take (said once above)
    const options = (w.options ?? []).filter((o) => full || !FROZEN_KEYS.has(o.key)).map((o) => (full
      ? `\`${o.key}\` (${o.required ? 'required ' : ''}${optionDetail(o)})${o.description ? ` - ${o.description}` : ''}`
      : `${o.key}${o.required ? '*' : ''} (${optionDetail(o, sameAs)})`)).join('; ');
    lines.push(`- \`${w.type}\` "${w.label}": ${w.purpose ?? ''}${options ? `. Options: ${options}` : ''}`);
  }
  lines.push('');

  lines.push('## Commands');
  lines.push('');
  if (full) lines.push('Effects: each command heading says how you use it. Commands marked "you run it" - `compute` commands, the camera / layout actions (`nav.*`, `layout.*`), `node.activate` (the active node: pulse, Molecular Structure windows), the AR molecule commands (`xr.molecule.*`) - you run with run_app_command; view changes (settings, windows) are cards; `selection` commands (`subset.*`: set, add, expand by one hop, connect, common neighbours, prune leaves, isolate, clear, save to library) and `data` commands are offered to the user as buttons (`cmd:` links, chips, cards). Every action of the app is a command with its own id - there is no menu indirection.');
  lines.push('');
  if (!full) lines.push('After the params: the effect and how you use it - `run` = you run it with run_app_command, `card` = a settings / window card, `button` = a `cmd:` link or chip for the user.');
  lines.push('Params are written as `{ name: type, optional?: type }`; `a | b` = one of.');
  lines.push('');
  // one line per command with a compact signature (N3: pretty-printed JSON schemas were ~14 KB)
  for (const c of catalog.commands) {
    lines.push(`- \`${c.id}\` ${paramsSignature(c.paramsSchema)} (${c.effect}, ${(full ? PRESENTATION_TEXT : PRESENTATION_SHORT)[presentationOf(c)]}): ${full ? `${c.label}. ${c.description}` : say(c.description, 75)}`);
  }
  lines.push('');
}

const ALL_KINDS = ['numeric', 'categorical', 'array', 'kv', 'categorical_kv', 'normalized', 'text'];

/** `numeric / category`; every kind = `any kind`, all but one = `any kind but text`. */
function kindsText(kinds: string[]): string {
  const missing = ALL_KINDS.filter((k) => !kinds.includes(k));
  if (kinds.every((k) => ALL_KINDS.includes(k)) && missing.length <= 1) return missing.length ? `any kind but ${KIND_WORDS[missing[0]!] ?? missing[0]}` : 'any kind';
  return kinds.map((k) => KIND_WORDS[k] ?? k).join(' / ');
}

const FROZEN_KEYS = new Set(['frozen', 'frozenIds']);

/** Column kind -> the words the app context uses for it. */
const KIND_WORDS: Record<string, string> = { categorical: 'category', array: 'list', kv: 'key:value', categorical_kv: 'category key:value' };

/** `column: numeric / category` (protocol 3, by kind; `also:` the built-ins), else the listed values (enums, edge columns, protocol 2). */
function optionDetail(o: NonNullable<AppCatalog['windows'][number]['options']>[number], sameAs?: (values: string[]) => string | undefined): string {
  // a long value list that a setting already lists (the layouts): name the setting instead (SKILL.md)
  const as = o.values && o.values.length > 6 ? sameAs?.(o.values) : undefined;
  if (as) return `${o.kind}: the values of ${as}`;
  if (o.columnKinds) {
    const kinds = kindsText(o.columnKinds);
    return `${o.kind}: ${kinds}${o.values?.length ? `; also: ${o.values.join(' / ')}` : ''}`;
  }
  return `${o.kind}${o.values ? `: ${o.values.join(' / ')}` : ''}`;
}

type Schema = Record<string, unknown>;

/** A JSON Schema type as a short TypeScript-like text: `string[]`, `"a" | "b"`, `number 0..1`, `{ k: string }`. */
function typeText(v: unknown): string {
  if (!v || typeof v !== 'object') return 'any';
  const t = v as Schema;
  if (Array.isArray(t.enum)) return t.enum.map((e) => JSON.stringify(e)).join(' | ');
  if (t.const !== undefined) return JSON.stringify(t.const);
  const alt = (t.anyOf ?? t.oneOf) as unknown[] | undefined;
  if (Array.isArray(alt)) return alt.map(typeText).join(' | ');
  if (Array.isArray(t.type)) return (t.type as string[]).join(' | ');
  const range = (): string => {
    const lo = typeof t.minimum === 'number' && Math.abs(t.minimum) < 1e15 ? t.minimum : undefined;
    const hi = typeof t.maximum === 'number' && Math.abs(t.maximum) < 1e15 ? t.maximum : undefined;
    return lo !== undefined || hi !== undefined ? ` ${lo ?? ''}..${hi ?? ''}` : '';
  };
  switch (t.type) {
    case 'array': {
      const item = typeText(t.items);
      return item.includes(' | ') ? `(${item})[]` : `${item}[]`;
    }
    case 'object': return t.properties && Object.keys(t.properties as Schema).length ? paramsSignature(t) : 'object';
    case 'integer': return `integer${range()}`;
    case 'number': return `number${range()}`;
    case 'string': case 'boolean': case 'null': return t.type;
    default: return 'any';
  }
}

/** A command's params schema as one line: `{ seeds?: string[], alpha?: number 0..1 }`; `{}` for none. */
export function paramsSignature(schema: Schema): string {
  const props = (schema.properties ?? {}) as Record<string, Schema>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const parts = Object.entries(props).map(([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${typeText(v)}${typeof v.description === 'string' ? ` (${v.description})` : ''}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

export async function writeCatalogSkill(workspace: string, catalog: AppCatalog): Promise<void> {
  const dir = join(workspace, '.claude', 'skills', CATALOG_SKILL_NAME);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), renderCatalogSkill(catalog));
  await writeFile(join(dir, CATALOG_REFERENCE_FILE), renderCatalogReference(catalog));
}
