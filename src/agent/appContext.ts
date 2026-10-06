/**
 * The app's snapshot -> files in the session workspace (`input/`) and the `<app_context>` block
 * that precedes every user message (plan, section 7c). Kept compact: the agent reads the files
 * for details.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppSnapshotSchema, type AppSnapshot, type ColumnInfo } from '../protocol.js';

const MAX_IDS_IN_PROMPT = 20;
const MAX_COLUMNS_WITH_STATS = 60;

const KIND_WORDS: Record<string, string> = {
  numeric: 'numeric',
  categorical: 'category',
  array: 'list',
  kv: 'key:value',
  categorical_kv: 'category key:value',
  normalized: 'numeric 0-1',
  text: 'text'
};

/** Writes app_context.json, selection.tsv and subset_library.tsv; returns the previous snapshot if any. */
export async function writeAppInputs(workspace: string, snapshot: AppSnapshot): Promise<AppSnapshot | null> {
  const input = join(workspace, 'input');
  await mkdir(input, { recursive: true });
  const contextFile = join(input, 'app_context.json');
  let previous: AppSnapshot | null = null;
  if (existsSync(contextFile)) {
    try {
      previous = AppSnapshotSchema.parse(JSON.parse(await readFile(contextFile, 'utf8')));
    } catch {
      previous = null;
    }
  }
  await writeFile(contextFile, JSON.stringify(snapshot, null, 2));
  await writeFile(join(input, 'selection.tsv'), ['_id', ...snapshot.selection.ids].join('\n') + '\n');
  await writeFile(
    join(input, 'subset_library.tsv'),
    ['name\tsize\tids', ...snapshot.subsetLibrary.map((s) => `${sanitize(s.name)}\t${s.ids.length}\t${s.ids.join(' ')}`)].join('\n') + '\n'
  );
  return previous;
}

/** The block the agent sees before the user's text. `userActions` = what the user did with cards / buttons since the last message. */
export function renderAppContext(snapshot: AppSnapshot, previous: AppSnapshot | null, userActions: string[] = []): string {
  const lines: string[] = [];
  lines.push(`dataset: ${snapshot.dataset} - ${snapshot.nodeCount} nodes, ${snapshot.edgeCount} edges, graph hash ${snapshot.graphHash}`);
  lines.push('files: input/nodes.tsv (all nodes, every column, _id = node id), input/edges.tsv (source, target = node ids), input/selection.tsv, input/subset_library.tsv, input/app_context.json (this context in full)');

  lines.push(`node columns (${snapshot.nodeColumns.length}; * = added or changed in the app, not in the loaded file):`);
  lines.push(...renderColumns(snapshot.nodeColumns, snapshot.nodeCount));
  if (snapshot.edgeColumns.length > 0) {
    lines.push(`edge columns (${snapshot.edgeColumns.length}):`);
    lines.push(...renderColumns(snapshot.edgeColumns, snapshot.edgeCount));
  }

  lines.push(`layouts: ${snapshot.layouts.map((l) => (l === snapshot.currentLayout ? `${l} (current)` : l)).join(', ')}; nodes coloured by ${snapshot.nodeColorAttribute}, sized by ${snapshot.nodeSizeAttribute}`);
  if (snapshot.viz && Object.keys(snapshot.viz).length > 0) {
    lines.push(`viz settings (change with settings.set; all settings, windows and commands: skill ${'asdf10k-app-catalog'}): ${Object.entries(snapshot.viz).map(([k, v]) => `${k}=${String(v)}`).join(', ')}`);
  }

  const sel = snapshot.selection;
  if (sel.count === 0) lines.push('selection: none');
  else {
    const shown = sel.ids.slice(0, MAX_IDS_IN_PROMPT).join(', ');
    lines.push(`selection: ${sel.count} nodes (all ids in input/selection.tsv): ${shown}${sel.count > MAX_IDS_IN_PROMPT ? ', ...' : ''}`);
  }
  lines.push(`active node: ${sel.activeId ?? 'none'}`);

  if (snapshot.subsetLibrary.length > 0) {
    lines.push(`subset library (${snapshot.subsetLibrary.length}, ids in input/subset_library.tsv): ${snapshot.subsetLibrary.map((s) => `${s.name} (${s.ids.length})`).join('; ')}`);
  } else lines.push('subset library: empty');

  if (snapshot.openWindows.length > 0) {
    lines.push(`open windows: ${snapshot.openWindows.map((w) => `${w.type}${w.id ? `#${w.id}` : ''}${describeConfig(w.config)}`).join('; ')}`);
  } else lines.push('open windows: none');

  const changes = describeChanges(snapshot, previous);
  if (changes.length > 0) lines.push(`since your last message: ${changes.join('; ')}`);
  if (userActions.length > 0) lines.push(`since your last message the user: ${userActions.join('; ')}`);

  return `<app_context>\n${lines.join('\n')}\n</app_context>`;
}

export function composePrompt(text: string, context: string): string {
  return `${context}\n\n${text}`;
}

/** Without a snapshot (older clients): only the user actions. */
export function renderUserActions(userActions: string[]): string {
  return `<app_context>\nsince your last message the user: ${userActions.join('; ')}\n</app_context>`;
}

// --- helpers -------------------------------------------------------------------------------------

function renderColumns(columns: ColumnInfo[], total: number): string[] {
  if (columns.length > MAX_COLUMNS_WITH_STATS) {
    // Many columns: names grouped by kind, stats in app_context.json.
    const byKind = new Map<string, string[]>();
    for (const c of columns) {
      const key = KIND_WORDS[c.kind] ?? c.kind;
      byKind.set(key, [...(byKind.get(key) ?? []), (c.origin === 'app' ? '*' : '') + c.name]);
    }
    return [...byKind.entries()].map(([kind, names]) => `  ${kind}: ${names.join(', ')}`).concat(['  (coverage and value ranges: input/app_context.json)']);
  }
  return columns.map((c) => {
    const parts = [`${c.origin === 'app' ? '*' : ''}${c.name}: ${KIND_WORDS[c.kind] ?? c.kind}`, `${c.nonEmpty}/${total}`];
    if (c.min !== undefined && c.max !== undefined) parts.push(`${fmt(c.min)}..${fmt(c.max)}`);
    if (c.distinct !== undefined && c.topValues && c.topValues.length > 0) {
      parts.push(`${c.distinct} distinct, top: ${c.topValues.map(([v, n]) => `${v} ${n}`).join(', ')}`);
    }
    if (c.description) parts.push(`- ${c.description}`);
    else if (c.source) parts.push(`- from ${c.source}`);
    return `  ${parts.join(', ')}`;
  });
}

function describeConfig(config: Record<string, unknown>): string {
  const keys = Object.entries(config).filter(([k, v]) => k !== 'bounds' && k !== 'xr' && k !== 'title' && v !== undefined && v !== null && typeof v !== 'object');
  return keys.length > 0 ? ` (${keys.map(([k, v]) => `${k}=${String(v)}`).join(', ')})` : '';
}

function describeChanges(now: AppSnapshot, previous: AppSnapshot | null): string[] {
  if (!previous) return [];
  const changes: string[] = [];
  if (now.graphHash !== previous.graphHash) {
    const before = new Set(previous.nodeColumns.map((c) => c.name));
    const added = now.nodeColumns.filter((c) => !before.has(c.name)).map((c) => c.name);
    const beforeE = new Set(previous.edgeColumns.map((c) => c.name));
    const addedE = now.edgeColumns.filter((c) => !beforeE.has(c.name)).map((c) => c.name);
    const what = [added.length ? `new node columns ${added.join(', ')}` : '', addedE.length ? `new edge columns ${addedE.join(', ')}` : ''].filter(Boolean);
    changes.push(`the graph files were re-uploaded${what.length ? ` (${what.join('; ')})` : ' (values changed)'}`);
  }
  if (now.selection.count !== previous.selection.count || now.selection.ids.some((id, i) => previous.selection.ids[i] !== id)) {
    changes.push(`the selection changed (${previous.selection.count} -> ${now.selection.count} nodes)`);
  }
  if (now.currentLayout !== previous.currentLayout) changes.push(`layout ${previous.currentLayout} -> ${now.currentLayout}`);
  return changes;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3);
}

function sanitize(s: string): string {
  return s.replace(/[\t\n\r]+/g, ' ');
}
