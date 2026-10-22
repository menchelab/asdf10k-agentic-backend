/**
 * The uploaded graph of a session (`input/nodes.tsv`): node ids and column names, for validating
 * what the agent proposes. Cached per workspace by the file's mtime.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface GraphIndex {
  ids: Set<string>;
  columns: Set<string>;
  /** The first few ids, spread over the file (multiplex data: copies of one name in several layers). */
  idExamples: string[];
  /** The `name` column: distinct names and the nodes carrying one (only when the column exists). */
  names?: { distinct: number; nodes: number };
}

const ID_EXAMPLES = 3;

const cache = new Map<string, { mtimeMs: number; index: GraphIndex }>();

export function readGraphIndex(workspace: string): GraphIndex | null {
  const file = join(workspace, 'input', 'nodes.tsv');
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.index;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const header = (lines[0] ?? '').replace(/\r$/, '').split('\t');
  const nameCol = header.indexOf('name');
  const ids = new Set<string>();
  const names = new Set<string>();
  let named = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').replace(/\r$/, '');
    if (!line) continue;
    const tab = line.indexOf('\t');
    ids.add(tab === -1 ? line : line.slice(0, tab));
    if (nameCol > 0) {
      const name = line.split('\t')[nameCol]?.trim();
      if (name) {
        names.add(name);
        named++;
      }
    }
  }
  const all = [...ids];
  const step = Math.max(1, Math.floor(all.length / ID_EXAMPLES));
  const idExamples = all.filter((_, i) => i % step === 0).slice(0, ID_EXAMPLES);
  const index: GraphIndex = { ids, columns: new Set(header), idExamples, ...(nameCol > 0 ? { names: { distinct: names.size, nodes: named } } : {}) };
  cache.set(file, { mtimeMs, index });
  return index;
}
