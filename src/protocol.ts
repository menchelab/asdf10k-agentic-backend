/**
 * Wire protocol between this backend and the asdf10k Agent window: the events of a session's
 * stream (SSE) and the request bodies. The app keeps a copy at `asdf10k/src/agent/protocol.ts`
 * - change both. Plan: asdf10k/docs/agent-window-plan.md, sections 5 and 6.
 */

import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

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

export const ProposalKindSchema = z.enum(['columns', 'subsets', 'command']);
export type ProposalKind = z.infer<typeof ProposalKindSchema>;

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
  z.object({ ...base, type: z.literal('status'), state: z.enum(['requesting', 'tool_running']), toolUseId: z.string().optional() }),
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
  z.object({ ...base, type: z.literal('image'), ...inRun, url: z.string(), caption: z.string(), toolUseId: z.string().optional() }),
  z.object({
    ...base,
    type: z.literal('table'),
    ...inRun,
    url: z.string(),
    caption: z.string(),
    columns: z.array(z.string()),
    previewRows: z.array(z.array(z.string()))
  }),
  z.object({
    ...base,
    type: z.literal('proposal'),
    ...inRun,
    proposalId: z.string(),
    kind: ProposalKindSchema,
    graphHash: z.string().optional(),
    summary: z.string(),
    data: z.unknown()
  }),
  z.object({ ...base, type: z.literal('proposal_outcome'), proposalId: z.string(), itemId: z.string().optional(), outcome: z.string(), detail: z.string().optional() }),
  z.object({
    ...base,
    type: z.literal('run_end'),
    ...inRun,
    status: RunStatusSchema,
    answeredMessageIds: z.array(z.string()),
    durationMs: z.number(),
    turns: z.number(),
    /** The SDK's estimate; with a CLI login nothing is billed per token. */
    costUsd: z.number()
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
  graphHash: z.string().optional()
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
  openWindows: z.array(z.object({ type: z.string(), title: z.string().optional(), config: z.record(z.string(), z.unknown()) }))
});
export type AppSnapshot = z.infer<typeof AppSnapshotSchema>;

export const PutGraphRequestSchema = z.object({ graphHash: z.string().min(1), nodesTsv: z.string(), edgesTsv: z.string() });

export const CreateSessionRequestSchema = z.object({ dataset: z.string().min(1), title: z.string().optional() });
export const PostMessageRequestSchema = z.object({
  text: z.string().min(1),
  snapshot: AppSnapshotSchema.optional(),
  /** Window descriptions + command list (phase 4). */
  catalog: z.unknown().optional()
});
export const ProposalOutcomeRequestSchema = z.object({ itemId: z.string().optional(), outcome: z.string().min(1), detail: z.string().optional() });

export interface HealthResponse {
  ok: boolean;
  version: string;
  protocol: number;
  sdkVersion: string;
  fake: boolean;
  /** The Python environment (python/.venv) exists. */
  python: boolean;
  liveSessions: number;
}

/** Payload of the SSE `ready` event sent once the replay is done. */
export interface ReadyPayload {
  lastSeq: number;
  status: z.infer<typeof SessionStatusSchema>;
}
