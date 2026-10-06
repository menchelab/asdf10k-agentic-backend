/**
 * The asdf10k MCP tools (in-process, one server per live session): `propose_node_columns` and
 * `publish_report`. Both validate a file the agent wrote, emit an event the window renders as a
 * card, and return quickly - the user decides at the card. Plan section 8 and 16.
 */

import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { EmitFn } from './EventNormalizer.js';
import { readGraphIndex } from './graphFiles.js';
import { validateColumnsTsv } from './validate/columnsTsv.js';
import { checkReportAgainstWorkspace, parseReportMarkdown, slugify } from './validate/report.js';
import { checkAppCommand } from './appCommandPolicy.js';
import { REPORT_NODE_ROLES, type AppCatalog, type AppResultRequest, type Report } from '../protocol.js';

export interface AppToolsContext {
  sessionId: string;
  dataset: string;
  workspace: string;
  emit: EmitFn;
  /** The run the tool call belongs to (from the normaliser). */
  currentRunId: () => string | null;
  /** The app catalog the session last received (commands with effects). */
  getCatalog: () => Promise<AppCatalog | null>;
  /** Asks the app to run a command and waits for its answer. */
  requestApp: (command: string, params: Record<string, unknown>, label: string) => Promise<AppResultRequest>;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

export function createAppToolsServer(ctx: AppToolsContext): McpSdkServerConfigWithInstance {
  const inWorkspace = (rel: string): string | null => {
    const abs = resolve(ctx.workspace, rel);
    return abs.startsWith(ctx.workspace + sep) ? abs : null;
  };
  const runId = (): string => ctx.currentRunId() ?? 'no-run';

  const proposeNodeColumns = tool(
    'propose_node_columns',
    'Offer the user new node columns from a TSV you wrote: first column _id (node ids as in input/nodes.tsv), then one column per value, each named with a kind suffix (_n number, _c category, _a comma list, _kv key:value pairs, _norm 0..1), empty cell = no value, prefix agent_. The user sees a card with Add / Discard; you learn the outcome with the next message. When the file is not acceptable you get the errors back - fix the file and call again.',
    {
      path: z.string().describe('workspace-relative path of the TSV, e.g. out/degree.tsv'),
      columns: z.array(z.object({ name: z.string(), description: z.string() })).describe('one entry per data column: the name as in the header and a one-line description for the user'),
      summary: z.string().describe('one sentence: what these columns are and how they were computed')
    },
    async ({ path, columns, summary }) => {
      const abs = inWorkspace(path);
      if (!abs || !existsSync(abs)) return text(`Not shown: file not found in the session folder: ${path}`, true);
      const graph = readGraphIndex(ctx.workspace);
      if (!graph) return text('Not shown: input/nodes.tsv is missing (no graph uploaded yet).', true);
      const v = validateColumnsTsv(readFileSync(abs, 'utf8'), graph.ids, graph.columns);
      if (!v.ok) return text(`Not shown to the user. Fix the file and call again:\n- ${v.errors.join('\n- ')}`, true);
      const described = new Map(columns.map((c) => [c.name, c.description]));
      const proposalId = randomUUID();
      ctx.emit({
        type: 'proposal',
        runId: runId(),
        proposalId,
        kind: 'columns',
        summary,
        data: {
          path,
          columns: v.columns.map((c) => ({ ...c, description: described.get(c.name) ?? '' })),
          matched: v.matched,
          total: v.total,
          header: v.header,
          previewRows: v.previewRows
        }
      });
      const warn = v.warnings.length ? `\nWarnings: ${v.warnings.join('; ')}` : '';
      return text(`Shown to the user as a card: ${v.columns.map((c) => c.name).join(', ')} for ${v.matched} of ${v.total} rows (${graph.ids.size} nodes in the graph). The user decides whether to add them; do not add them yourself.${warn}`);
    },
    { alwaysLoad: true }
  );

  const publishReport = tool(
    'publish_report',
    `Publish a markdown report file to the user: it appears as a card in the chat and in the Reports window, with its images, and can later be shown in the 3D graph. The file starts with YAML front matter: title, summary (2-3 lines), nodes (list of { id, role } with role one of ${REPORT_NODE_ROLES.join(' | ')}), optional tags; then the markdown body (tables, images with relative paths, cmd: links, asdf10k blocks, mermaid). Calling again with the same file replaces the report. Errors come back when the file is not acceptable - fix and call again.`,
    { path: z.string().describe('workspace-relative path, e.g. out/reports/metabolites.md') },
    async ({ path }) => {
      const abs = inWorkspace(path);
      if (!abs || !existsSync(abs)) return text(`Not published: file not found in the session folder: ${path}`, true);
      const parsed = parseReportMarkdown(readFileSync(abs, 'utf8'));
      if (!parsed.ok || !parsed.report) return text(`Not published. Fix the file and call again:\n- ${parsed.errors.join('\n- ')}`, true);
      const graph = readGraphIndex(ctx.workspace);
      const errors = graph ? checkReportAgainstWorkspace(parsed.report, graph.ids, (rel) => existsSync(inWorkspace(rel) ?? '')) : ['input/nodes.tsv is missing (no graph uploaded yet)'];
      if (errors.length > 0) return text(`Not published. Fix the file and call again:\n- ${errors.join('\n- ')}`, true);
      const r = parsed.report;
      const notes: string[] = [];
      if (r.dataset && r.dataset !== ctx.dataset) notes.push(`front matter dataset "${r.dataset}" differs from the session's "${ctx.dataset}"; the report is filed under "${ctx.dataset}"`);
      const report: Report = {
        reportId: `${ctx.sessionId}:${slugify(path.split('/').pop() ?? path)}`,
        sessionId: ctx.sessionId,
        title: r.title,
        summary: r.summary,
        dataset: ctx.dataset,
        ...(r.graphHash ? { graphHash: r.graphHash } : {}),
        nodes: r.nodes,
        tags: r.tags,
        markdown: r.markdown,
        files: r.files,
        sourcePath: path,
        createdAt: Date.now()
      };
      ctx.emit({ type: 'report', runId: runId(), report });
      return text(`Published "${r.title}" (${r.nodes.length} nodes, ${r.files.length} files). The user sees a card and can open the report.${notes.length ? `\nNote: ${notes.join('; ')}` : ''}`);
    },
    { alwaysLoad: true }
  );

  const runAppCommand = tool(
    'run_app_command',
    "Runs a command in the app (the user's browser) and waits for the result. For compute commands (rwr.run, cluster.run - the app's own GPU random walk and clustering; new columns are in input/nodes.tsv right after the call) and view commands (settings.set, window.open, menu.run). The command list with parameter schemas is in the skill asdf10k-app-catalog. Commands that change the selection or add data (subset.*, columns.addFromTsv) are refused here: offer them as buttons instead.",
    {
      command: z.string().describe('command id, e.g. rwr.run'),
      params: z.record(z.string(), z.unknown()).optional().describe('parameters per the command schema')
    },
    async ({ command, params }) => {
      const check = checkAppCommand(await ctx.getCatalog(), command);
      if (!check.ok) return text(check.error, true);
      const before = readGraphIndex(ctx.workspace)?.columns ?? new Set<string>();
      let answer: AppResultRequest;
      try {
        answer = await ctx.requestApp(command, params ?? {}, check.label);
      } catch (e) {
        return text(`${check.label}: ${e instanceof Error ? e.message : String(e)}`, true);
      }
      if (!answer.ok) return text(`${check.label} failed: ${answer.error ?? 'unknown error'}`, true);
      const after = readGraphIndex(ctx.workspace)?.columns ?? new Set<string>();
      const newColumns = [...after].filter((c) => !before.has(c));
      const parts = [`${check.label}: done.`];
      if (answer.result !== undefined) parts.push(`Result: ${JSON.stringify(answer.result)}`);
      if (newColumns.length > 0) parts.push(`New node columns in input/nodes.tsv: ${newColumns.join(', ')}.`);
      else if (answer.graphHash) parts.push('input/nodes.tsv and input/edges.tsv were re-uploaded (values or edge columns changed).');
      if (answer.viz) parts.push(`Viz now: ${Object.entries(answer.viz).map(([k, v]) => `${k}=${String(v)}`).join(', ')}.`);
      return text(parts.join('\n'));
    },
    { alwaysLoad: true }
  );

  return createSdkMcpServer({ name: 'asdf10k', version: '0.1.0', tools: [proposeNodeColumns, publishReport, runAppCommand] });
}
