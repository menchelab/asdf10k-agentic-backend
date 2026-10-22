/**
 * Wire protocol between this backend and the asdf10k Agent window: the events of a session's
 * stream (SSE) and the request bodies. The app keeps a copy at `asdf10k/src/agent/protocol.ts`
 * - change both. Plan: asdf10k/docs/agent-window-plan.md, sections 5 and 6.
 */

import { z } from 'zod';

export const PROTOCOL_VERSION = 3;

export const RunStatusSchema = z.enum(['success', 'max_turns', 'interrupted', 'error']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export const TodoItemSchema = z.object({
  id: z.string(),
  subject: z.string(),
  activeForm: z.string().optional(),
  status: TodoStatusSchema
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const ProposalKindSchema = z.enum(['columns']);
export type ProposalKind = z.infer<typeof ProposalKindSchema>;

/** Data of a `columns` proposal (propose_node_columns). `path` is workspace-relative; the app resolves it to the session file URL. */
export const ColumnsProposalDataSchema = z.object({
  path: z.string(),
  columns: z.array(z.object({ name: z.string(), kind: z.string(), description: z.string(), nonEmpty: z.number() })),
  /** Rows whose id is in the graph / rows in the file. */
  matched: z.number(),
  total: z.number(),
  header: z.array(z.string()),
  previewRows: z.array(z.array(z.string()))
});
export type ColumnsProposalData = z.infer<typeof ColumnsProposalDataSchema>;

export const ReportNodeRoleSchema = z.enum(['subject', 'evidence', 'candidate', 'context']);
export type ReportNodeRole = z.infer<typeof ReportNodeRoleSchema>;
export const REPORT_NODE_ROLES: readonly ReportNodeRole[] = ReportNodeRoleSchema.options;

/** A published report (plan section 16). Markdown and metadata travel in the event; files are workspace-relative paths. */
export const ReportSchema = z.object({
  reportId: z.string(),
  sessionId: z.string(),
  title: z.string(),
  summary: z.string(),
  dataset: z.string(),
  graphHash: z.string().optional(),
  nodes: z.array(z.object({ id: z.string(), role: ReportNodeRoleSchema })),
  tags: z.array(z.string()),
  /** Markdown body (front matter removed). */
  markdown: z.string(),
  /** Workspace-relative files the markdown references (images, data). */
  files: z.array(z.string()),
  sourcePath: z.string(),
  createdAt: z.number()
});
export type Report = z.infer<typeof ReportSchema>;

const base = { seq: z.number().int().nonnegative(), ts: z.number() };
const inRun = { runId: z.string() };

/**
 * One event of a session. `seq` is assigned by the event log (also for events that are not
 * persisted, such as `text_delta` and `status`); a client resumes with `?after=<seq>`.
 */
export const AgentEventSchema = z.discriminatedUnion('type', [
  /** A user message was accepted (also while a run is active: the SDK folds it into that run). */
  z.object({ ...base, type: z.literal('user_message'), messageId: z.string(), text: z.string() }),
  /** A turn of the agent started; `background_task` = no user message, a backgrounded task finished. */
  z.object({ ...base, type: z.literal('run_start'), ...inRun, trigger: z.enum(['user', 'background_task']) }),
  /** First init of a live query: what the agent has. */
  z.object({
    ...base,
    type: z.literal('init'),
    model: z.string(),
    tools: z.array(z.string()),
    skills: z.array(z.string()),
    sdkSessionId: z.string(),
    claudeCodeVersion: z.string()
  }),
  /** Transient: the model is being called / a tool has been running for a while. Not persisted. */
  /** `waiting` (not persisted): no SDK message for `idleMs` while a run is active - the model has not answered yet. */
  z.object({ ...base, type: z.literal('status'), state: z.enum(['requesting', 'tool_running', 'waiting']), toolUseId: z.string().optional(), idleMs: z.number().optional() }),
  /** "What's up?": a side question answered from a fork of the session; shown under the run it was asked in. */
  z.object({ ...base, type: z.literal('aside'), runId: z.string().nullable(), question: z.string(), answer: z.string() }),
  /** Streamed text; not persisted (the final `text` is). */
  z.object({ ...base, type: z.literal('text_delta'), ...inRun, blockId: z.string(), text: z.string() }),
  z.object({ ...base, type: z.literal('text'), ...inRun, blockId: z.string(), text: z.string() }),
  z.object({
    ...base,
    type: z.literal('tool_start'),
    ...inRun,
    toolUseId: z.string(),
    name: z.string(),
    label: z.string(),
    input: z.unknown(),
    parentToolUseId: z.string().nullable()
  }),
  z.object({ ...base, type: z.literal('tool_end'), ...inRun, toolUseId: z.string(), ok: z.boolean(), summary: z.string(), durationMs: z.number() }),
  /** The agent's current to-do list (full list each time). */
  z.object({ ...base, type: z.literal('todos'), ...inRun, items: z.array(TodoItemSchema) }),
  /** A tool proposal shown as a card (columns: Add / Discard). */
  z.object({
    ...base,
    type: z.literal('proposal'),
    ...inRun,
    proposalId: z.string(),
    kind: ProposalKindSchema,
    graphHash: z.string().optional(),
    summary: z.string(),
    data: ColumnsProposalDataSchema
  }),
  /** publish_report: the report itself (the app keeps it in its store). */
  z.object({ ...base, type: z.literal('report'), ...inRun, report: ReportSchema }),
  /** What the user did with a card / button (posted by the app; prefixed to the agent's next message). */
  z.object({ ...base, type: z.literal('feedback'), text: z.string(), proposalId: z.string().optional(), outcome: z.string().optional(), data: z.record(z.string(), z.unknown()).optional() }),
  /** run_app_command: the app should run this command and POST the result to /app-results/:requestId. Not persisted. */
  z.object({ ...base, type: z.literal('app_request'), requestId: z.string(), command: z.string(), params: z.record(z.string(), z.unknown()), label: z.string() }),
  z.object({
    ...base,
    type: z.literal('run_end'),
    ...inRun,
    status: RunStatusSchema,
    answeredMessageIds: z.array(z.string()),
    durationMs: z.number(),
    turns: z.number(),
    /** The SDK's estimate for this run (since 2026-10-22; before: the session's running total); with a CLI login nothing is billed per token. */
    costUsd: z.number(),
    /** The SDK's running total for the session (optional, since 2026-10-22). */
    sessionCostUsd: z.number().optional()
  }),
  z.object({ ...base, type: z.literal('error'), message: z.string() })
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = AgentEvent['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the log assigns `seq` and `ts`. */
export type AgentEventInput = DistributiveOmit<AgentEvent, 'seq' | 'ts'>;

export const SessionStatusSchema = z.enum(['idle', 'running', 'interrupted', 'error']);
export const SessionMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  dataset: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Claude Code session id, known after the first init; used to resume. */
  sdkSessionId: z.string().optional(),
  status: SessionStatusSchema,
  /** Hash of the last graph upload (phase 2). */
  graphHash: z.string().optional(),
  /** Hash of the app catalog the generated skill was written from (phase 4). */
  catalogHash: z.string().optional(),
  /** Hash of the dataset description in the session's system prompt ('' = the dataset has none). */
  dataDescriptionHash: z.string().optional()
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;

// --- app snapshot: what the app sends with every message (plan section 7c) ---------------------

export const ColumnInfoSchema = z.object({
  name: z.string(),
  /** The app's ColumnKind from the name suffix ('numeric', 'categorical', 'array', 'kv', ...). */
  kind: z.string(),
  /** Nodes / edges with a value. */
  nonEmpty: z.number(),
  /** 'file' = in the TSV the app loaded; 'app' = added or changed in the app (any tool). */
  origin: z.enum(['file', 'app']),
  source: z.string().optional(),
  description: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  distinct: z.number().optional(),
  /** Most frequent values with counts (categorical / array columns). */
  topValues: z.array(z.tuple([z.string(), z.number()])).optional()
});
export type ColumnInfo = z.infer<typeof ColumnInfoSchema>;

export const AppSnapshotSchema = z.object({
  dataset: z.string(),
  /** Hash of the graph export (nodes + edges TSV); the backend has the files when meta.graphHash matches. */
  graphHash: z.string(),
  nodeCount: z.number(),
  edgeCount: z.number(),
  nodeColumns: z.array(ColumnInfoSchema),
  edgeColumns: z.array(ColumnInfoSchema),
  layouts: z.array(z.string()),
  currentLayout: z.string(),
  nodeColorAttribute: z.string(),
  nodeSizeAttribute: z.string(),
  selection: z.object({
    count: z.number(),
    /** TSV ids (`_id`), all of them. */
    ids: z.array(z.string()),
    activeId: z.string().nullable()
  }),
  subsetLibrary: z.array(z.object({ name: z.string(), ids: z.array(z.string()) })),
  /** `id` = the window's storage key (e.g. distribution-2): what window.configure / window.close address. */
  openWindows: z.array(z.object({ type: z.string(), id: z.string().optional(), title: z.string().optional(), config: z.record(z.string(), z.unknown()) })),
  /** Current values of the viz settings by ring id (`nodes.colorAttribute`, `nodes.colorMethod`, ...). */
  viz: z.record(z.string(), z.unknown()).optional(),
  /** The Agent window's auto-accept toggle: settings cards apply themselves (true) or wait for the user's Accept (protocol 3). */
  autoAccept: z.boolean().optional()
});
export type AppSnapshot = z.infer<typeof AppSnapshotSchema>;

// --- app catalog: what the app can do (plan phase 4) ---------------------------------------------

export const CatalogSettingSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: z.string(),
  type: z.enum(['dropdown', 'toggle', 'number']),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  unit: z.string().optional(),
  /** One line on what the setting does (hand-written notes in AppCatalog.ts). */
  description: z.string().optional(),
  /** The agent may read but not change it (settings.set refuses it); it tells the user what to change where. */
  readOnly: z.boolean().optional(),
  /** shared = a change reaches everyone in a multiplayer session; device = this device only (bloom, render). Protocol 2. */
  scope: z.enum(['shared', 'device']).optional(),
  /**
   * A dropdown over columns (colour / size attribute ...): it also takes any `columnsOf` column of
   * these kinds (the columns are in the app context), and `options` keeps only the non-column values
   * (`original`, `uniform`). Optional, no version bump: an older side ignores it (finding N3).
   */
  columnKinds: z.array(z.string()).optional(),
  columnsOf: z.enum(['node', 'edge']).optional()
});
export type CatalogSetting = z.infer<typeof CatalogSettingSchema>;
export const CatalogWindowSchema = z.object({
  type: z.string(),
  label: z.string(),
  purpose: z.string().optional(),
  /**
   * `values`: the allowed values (enums, edge columns; for column options only the window's built-in
   * columns such as `label`). `columnKinds` (protocol 3): a column option takes any node column of these
   * kinds - the columns themselves are in the app context, not repeated per option.
   */
  options: z.array(z.object({ key: z.string(), kind: z.string(), required: z.boolean().optional(), values: z.array(z.string()).optional(), columnKinds: z.array(z.string()).optional(), description: z.string().optional() })).optional()
});
export type CatalogWindow = z.infer<typeof CatalogWindowSchema>;
/**
 * How the agent uses a command (protocol 2; from the app's command registry): `direct` = it runs it
 * itself (run_app_command), `card` = a view change it writes as a change card (settings / window
 * blocks), `button` = it offers it to the user as a button (selection, data). Missing = protocol 1
 * (derive it from `effect`).
 */
export const CommandPresentationSchema = z.enum(['direct', 'card', 'button']);
export type CommandPresentation = z.infer<typeof CommandPresentationSchema>;
export const CatalogCommandSchema = z.object({ id: z.string(), label: z.string(), description: z.string(), effect: z.string(), presentation: CommandPresentationSchema.optional(), paramsSchema: z.record(z.string(), z.unknown()) });
export type CatalogCommand = z.infer<typeof CatalogCommandSchema>;
export const AppCatalogSchema = z.object({
  /** Hash of the structure (ids, options), not of current values. */
  hash: z.string(),
  settings: z.array(CatalogSettingSchema),
  windows: z.array(CatalogWindowSchema),
  commands: z.array(CatalogCommandSchema)
});
export type AppCatalog = z.infer<typeof AppCatalogSchema>;

export const PutGraphRequestSchema = z.object({ graphHash: z.string().min(1), nodesTsv: z.string(), edgesTsv: z.string() });

export const CreateSessionRequestSchema = z.object({ dataset: z.string().min(1), title: z.string().optional() });
export const PostMessageRequestSchema = z.object({
  text: z.string().min(1),
  snapshot: AppSnapshotSchema.optional(),
  /** Sent when its hash differs from the session's catalogHash; rendered into a skill. */
  catalog: AppCatalogSchema.optional(),
  /**
   * The dataset's data_description.txt (written for the agent by the dataset's authors; text '' = none),
   * sent when its hash differs from the session's dataDescriptionHash; appended to the system prompt.
   */
  dataDescription: z.object({ hash: z.string(), text: z.string().max(200_000) }).optional()
});
/** POST /sessions/:id/app-results/:requestId: the app's answer to an app_request. */
export const AppResultRequestSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  /** Set when the app re-uploaded the graph after the command (new columns). */
  graphHash: z.string().optional(),
  /** Viz settings after the command. */
  viz: z.record(z.string(), z.unknown()).optional(),
  /** The store transactions the command committed (its synchronous part; protocol 2). */
  txIds: z.array(z.number()).optional()
});
export type AppResultRequest = z.infer<typeof AppResultRequestSchema>;

/** POST /sessions/:id/aside: a side question ("What's up?") answered without touching the run. */
export const AsideRequestSchema = z.object({ text: z.string().min(1).max(2000).optional() });
export type AsideRequest = z.infer<typeof AsideRequestSchema>;

/** POST /sessions/:id/feedback: one line the agent should know ("saved subset hubs_2 (12 nodes)"), optionally tied to a proposal card. */
export const FeedbackRequestSchema = z.object({
  text: z.string().min(1),
  proposalId: z.string().optional(),
  outcome: z.string().optional(),
  /** Card state to restore on replay (change cards: the pending inverse changes). */
  data: z.record(z.string(), z.unknown()).optional()
});

export interface HealthResponse {
  ok: boolean;
  version: string;
  protocol: number;
  sdkVersion: string;
  fake: boolean;
  /** The Python environment (python/.venv) exists. */
  python: boolean;
  liveSessions: number;
  /** Speech to text for the push-to-talk button (whisper.cpp); `problem` says what is missing. */
  transcribe?: { available: boolean; model: string | null; problem: string | null };
}

/** Payload of the SSE `ready` event sent once the replay is done. */
export interface ReadyPayload {
  lastSeq: number;
  status: z.infer<typeof SessionStatusSchema>;
}
