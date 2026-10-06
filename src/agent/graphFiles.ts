/**
 * The uploaded graph of a session (`input/nodes.tsv`): node ids and column names, for validating
 * what the agent proposes. Cached per workspace by the file's mtime.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface GraphIndex {
  ids: Set<string>;
  columns: Set<string>;
}

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
  const ids = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line) continue;
    const tab = line.indexOf('\t');
    ids.add((tab === -1 ? line : line.slice(0, tab)).replace(/\r$/, ''));
  }
  const index = { ids, columns: new Set(header) };
  cache.set(file, { mtimeMs, index });
  return index;
}
