import { describe, expect, it } from 'vitest';
import { validateColumnsTsv } from '../src/agent/validate/columnsTsv.js';
import { checkReportAgainstWorkspace, parseReportMarkdown, referencedFiles, slugify } from '../src/agent/validate/report.js';

const graph = new Set(['A1BG_p', 'C3_p', 'CR1_p']);
const existing = new Set(['_id', 'degree_n', 'layer_c']);

describe('validateColumnsTsv', () => {
  it('accepts a good file and counts coverage', () => {
    const v = validateColumnsTsv('_id\tagent_score_n\tagent_tags_a\nA1BG_p\t0.5\ta,b\nC3_p\t\tc\nZZZ\t1\t\n', graph, existing);
    expect(v.ok).toBe(true);
    expect(v.total).toBe(3);
    expect(v.matched).toBe(2);
    expect(v.columns.map((c) => [c.name, c.kind, c.nonEmpty])).toEqual([
      ['agent_score_n', 'numeric', 2],
      ['agent_tags_a', 'array', 2]
    ]);
    expect(v.warnings.join(' ')).toContain('1 of 3 ids are not in the graph');
    expect(v.previewRows[0]).toEqual(['A1BG_p', '0.5', 'a,b']);
  });

  it('rejects a wrong id column, missing suffixes, clashes and bad numbers', () => {
    const v = validateColumnsTsv('name\tscore\tdegree_n\nA1BG_p\tx\t1\n', graph, existing);
    expect(v.ok).toBe(false);
    expect(v.errors.join('\n')).toMatch(/first column must be the node id/);
    expect(v.errors.join('\n')).toMatch(/"score" has no kind suffix/);
    expect(v.errors.join('\n')).toMatch(/"degree_n" exists already/);
    const v2 = validateColumnsTsv('_id\tagent_x_n\nA1BG_p\tabc\n', graph, existing);
    expect(v2.ok).toBe(false);
    expect(v2.errors.join('\n')).toMatch(/not numbers/);
  });

  it('rejects when no id matches and key:value cells without colon', () => {
    const v = validateColumnsTsv('_id\tagent_kv_kv\nnope\ta:1,b\n', graph, existing);
    expect(v.ok).toBe(false);
    expect(v.errors.join('\n')).toMatch(/none of the 1 ids/);
    expect(v.errors.join('\n')).toMatch(/without a colon/);
  });
});

const md = `---
title: Test report
summary: Two lines
  of summary.
nodes:
  - { id: A1BG_p, role: subject }
  - { id: C3_p, role: evidence }
tags: [a, b]
---
# Body

![plot](../plots/p.svg) and [data](out/x.tsv) and [web](https://x.y/z) and [act](cmd:subset.set?ids=A1BG_p)
`;

describe('parseReportMarkdown', () => {
  it('parses front matter, body and referenced files', () => {
    const r = parseReportMarkdown(md);
    expect(r.ok).toBe(true);
    expect(r.report?.title).toBe('Test report');
    expect(r.report?.nodes).toEqual([
      { id: 'A1BG_p', role: 'subject' },
      { id: 'C3_p', role: 'evidence' }
    ]);
    expect(r.report?.tags).toEqual(['a', 'b']);
    expect(r.report?.markdown.startsWith('# Body')).toBe(true);
    expect(r.report?.files).toEqual(['../plots/p.svg', 'out/x.tsv']);
  });

  it('reports missing fields and bad roles', () => {
    const r = parseReportMarkdown('---\ntitle: x\nnodes:\n  - { id: A1BG_p, role: hero }\n---\nbody');
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/summary/);
    expect(r.errors.join('\n')).toMatch(/role "hero"/);
    expect(parseReportMarkdown('no front matter').ok).toBe(false);
  });

  it('checks ids and files against the workspace', () => {
    const r = parseReportMarkdown(md);
    const errors = checkReportAgainstWorkspace(r.report!, new Set(['A1BG_p']), (rel) => rel === 'out/x.tsv');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('C3_p');
    expect(errors[1]).toContain('../plots/p.svg');
  });

  it('helpers', () => {
    expect(referencedFiles('![a](./out/a.png "t") [b](#x) [c](/abs)')).toEqual(['out/a.png']);
    expect(slugify('My Report.md')).toBe('my-report');
  });
});
