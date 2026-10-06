/**
 * Checks a TSV the agent wants to add as node columns (propose_node_columns) against the app's
 * column rules (asdf10k docs/core/ColumnTypes.md): id column first, a kind suffix per column,
 * numbers parse, separators fit, ids exist in the graph, no clash with existing columns.
 */

export interface ColumnCheck {
  name: string;
  kind: string;
  nonEmpty: number;
}

export interface ColumnsValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  header: string[];
  columns: ColumnCheck[];
  /** Data rows / rows whose id is in the graph. */
  total: number;
  matched: number;
  previewRows: string[][];
}

const PREVIEW_ROWS = 5;
const MAX_REPORTED = 5;

/** The app's suffix rule (ColumnTypes.ts), longest suffix first; null = no kind suffix. */
export function kindOf(name: string): string | null {
  if (name.endsWith('_c_kv')) return 'categorical_kv';
  if (name.endsWith('_kv')) return 'kv';
  if (name.endsWith('_a')) return 'array';
  if (name.endsWith('_c')) return 'categorical';
  if (name.endsWith('_n')) return 'numeric';
  if (name.endsWith('_norm')) return 'normalized';
  return null;
}

export function validateColumnsTsv(text: string, graphIds: ReadonlySet<string>, existingColumns: ReadonlySet<string>): ColumnsValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const headerLine = lines.shift() ?? '';
  const header = headerLine.split('\t').map((h) => h.trim());
  const result = (ok: boolean, columns: ColumnCheck[] = [], total = 0, matched = 0, previewRows: string[][] = []): ColumnsValidation => ({ ok, errors, warnings, header, columns, total, matched, previewRows });

  if (header.length < 2) {
    errors.push('the header needs the id column and at least one data column, tab-separated');
    return result(false);
  }
  const idHeader = header[0] ?? '';
  if (idHeader !== '_id' && idHeader !== 'id') errors.push(`the first column must be the node id, named "_id" (or "id"), not "${idHeader}"`);

  const dataNames = header.slice(1);
  const seen = new Set<string>();
  const columns: ColumnCheck[] = [];
  dataNames.forEach((name, i) => {
    if (!name) errors.push(`column ${i + 2} has an empty name`);
    else if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) errors.push(`column "${name}": use letters, digits and underscores only`);
    const kind = kindOf(name);
    if (!kind) errors.push(`column "${name}" has no kind suffix (_n numeric, _c category, _a list, _kv key:value, _norm 0-1)`);
    if (existingColumns.has(name)) errors.push(`column "${name}" exists already; pick another name (agent_ prefix)`);
    if (seen.has(name)) errors.push(`column "${name}" appears twice in the header`);
    seen.add(name);
    columns.push({ name, kind: kind ?? 'text', nonEmpty: 0 });
  });
  if (errors.length > 0) return result(false, columns);

  let matched = 0;
  const ids = new Set<string>();
  const previewRows: string[][] = [];
  const badNumbers: string[] = [];
  const badPairs: string[] = [];
  const dupIds: string[] = [];
  const unknownIds: string[] = [];
  let widthProblems = 0;
  lines.forEach((line, rowIndex) => {
    if (line === '') return;
    const cells = line.split('\t');
    if (cells.length !== header.length) widthProblems += 1;
    const id = (cells[0] ?? '').trim();
    if (!id) return;
    if (ids.has(id)) dupIds.push(id);
    ids.add(id);
    if (graphIds.has(id)) matched += 1;
    else unknownIds.push(id);
    if (previewRows.length < PREVIEW_ROWS) previewRows.push(cells.slice(0, header.length).map((c) => c.trim()));
    columns.forEach((col, ci) => {
      const value = (cells[ci + 1] ?? '').trim();
      if (value === '') return;
      col.nonEmpty += 1;
      if (col.kind === 'numeric' || col.kind === 'normalized') {
        const n = Number(value);
        if (!Number.isFinite(n)) badNumbers.push(`${col.name} row ${rowIndex + 2}: "${value}"`);
        else if (col.kind === 'normalized' && (n < 0 || n > 1)) warnings.push(`${col.name} row ${rowIndex + 2}: ${value} is outside 0..1`);
      } else if (col.kind === 'kv' || col.kind === 'categorical_kv') {
        for (const pair of value.split(',')) if (pair.trim() && !pair.includes(':')) badPairs.push(`${col.name} row ${rowIndex + 2}: "${pair.trim()}" has no key:value colon`);
      }
    });
  });
  const total = ids.size;
  const firstFew = (xs: string[]): string => xs.slice(0, MAX_REPORTED).join(', ') + (xs.length > MAX_REPORTED ? `, ... (${xs.length} total)` : '');

  if (total === 0) errors.push('no data rows');
  if (widthProblems > 0) errors.push(`${widthProblems} row(s) do not have ${header.length} tab-separated cells`);
  if (dupIds.length > 0) errors.push(`duplicate ids: ${firstFew([...new Set(dupIds)])}`);
  if (badNumbers.length > 0) errors.push(`values that are not numbers: ${firstFew(badNumbers)}`);
  if (badPairs.length > 0) errors.push(`key:value cells without a colon: ${firstFew(badPairs)}`);
  if (total > 0 && matched === 0) errors.push(`none of the ${total} ids is in the graph (ids are the _id column of input/nodes.tsv): ${firstFew(unknownIds)}`);
  else if (unknownIds.length > 0) warnings.push(`${unknownIds.length} of ${total} ids are not in the graph and will be skipped: ${firstFew(unknownIds)}`);
  for (const col of columns) if (col.nonEmpty === 0) warnings.push(`column "${col.name}" has no values`);

  return result(errors.length === 0, columns, total, matched, previewRows);
}
