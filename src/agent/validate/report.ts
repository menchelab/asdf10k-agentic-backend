/**
 * Parses and checks a report the agent wants to publish (publish_report, plan section 16): YAML
 * front matter with title, summary, nodes (id + role from the fixed set), optional dataset /
 * graphHash / tags; the markdown body; the workspace files it references.
 */

import { parse as parseYaml } from 'yaml';
import { REPORT_NODE_ROLES, type ReportNodeRole } from '../../protocol.js';

export interface ParsedReport {
  title: string;
  summary: string;
  dataset?: string;
  graphHash?: string;
  nodes: Array<{ id: string; role: ReportNodeRole }>;
  tags: string[];
  markdown: string;
  /** Relative paths referenced by images and links (not http(s), data:, cmd:, anchors). */
  files: string[];
}

export interface ReportParseResult {
  ok: boolean;
  errors: string[];
  report?: ParsedReport;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ROLE_SET = new Set<string>(REPORT_NODE_ROLES);

export function parseReportMarkdown(text: string): ReportParseResult {
  const errors: string[] = [];
  const m = FRONT_MATTER.exec(text);
  if (!m) return { ok: false, errors: ['the file must start with a YAML front matter block (--- ... ---) holding title, summary and nodes'] };
  let meta: unknown;
  try {
    meta = parseYaml(m[1] ?? '');
  } catch (e) {
    return { ok: false, errors: [`front matter is not valid YAML: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { ok: false, errors: ['front matter must be a YAML mapping'] };
  const o = meta as Record<string, unknown>;
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string).trim() : typeof o[k] === 'number' ? String(o[k]) : '');

  const title = str('title');
  const summary = str('summary');
  if (!title) errors.push('front matter: "title" is missing');
  if (!summary) errors.push('front matter: "summary" (2-3 lines) is missing');

  const nodes: Array<{ id: string; role: ReportNodeRole }> = [];
  const rawNodes = o.nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) errors.push('front matter: "nodes" must be a non-empty list of { id, role }');
  else {
    const seen = new Set<string>();
    rawNodes.forEach((n, i) => {
      if (!n || typeof n !== 'object') {
        errors.push(`nodes[${i}] must be a mapping { id, role }`);
        return;
      }
      const r = n as Record<string, unknown>;
      const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id).trim() : '';
      const role = typeof r.role === 'string' ? r.role.trim() : '';
      if (!id) errors.push(`nodes[${i}]: "id" is missing`);
      if (!ROLE_SET.has(role)) errors.push(`nodes[${i}] (${id || '?'}): role "${role}" is not one of ${REPORT_NODE_ROLES.join(', ')}`);
      if (id && seen.has(id)) errors.push(`nodes: id "${id}" appears twice`);
      seen.add(id);
      if (id && ROLE_SET.has(role)) nodes.push({ id, role: role as ReportNodeRole });
    });
  }

  const tags = Array.isArray(o.tags) ? (o.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean) : [];
  const markdown = text.slice(m[0].length).trim();
  if (!markdown) errors.push('the report has no body after the front matter');

  if (errors.length > 0) return { ok: false, errors };
  const report: ParsedReport = { title, summary, nodes, tags, markdown, files: referencedFiles(markdown) };
  const dataset = str('dataset');
  const graphHash = str('graphHash');
  if (dataset) report.dataset = dataset;
  if (graphHash) report.graphHash = graphHash;
  return { ok: true, errors, report };
}

/** Relative image / link targets in the markdown body. */
export function referencedFiles(markdown: string): string[] {
  const out = new Set<string>();
  const re = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const target = m[1] ?? '';
    if (/^(https?:|data:|cmd:|mailto:|#|\/)/i.test(target)) continue;
    out.add(target.replace(/^\.\//, ''));
  }
  return [...out];
}

/** Ids not in the graph and files not in the workspace, as error lines. */
export function checkReportAgainstWorkspace(report: ParsedReport, graphIds: ReadonlySet<string>, fileExists: (rel: string) => boolean): string[] {
  const errors: string[] = [];
  const unknown = report.nodes.filter((n) => !graphIds.has(n.id)).map((n) => n.id);
  if (unknown.length > 0) errors.push(`node ids not in the graph (use _id from input/nodes.tsv): ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? ', ...' : ''}`);
  const missing = report.files.filter((f) => !fileExists(f));
  if (missing.length > 0) errors.push(`referenced files not found in the session folder: ${missing.join(', ')}`);
  return errors;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';
}
