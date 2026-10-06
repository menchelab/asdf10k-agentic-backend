/**
 * Sessions on disk (`<SESSIONS_DIR>/<id>/meta.json`, `events.jsonl`, `workspace/`) and the live
 * agent per session: created on the first message, closed after an idle time, resumed by the
 * Claude Code session id on the next message.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config } from '../config.js';
import { EventLog } from './EventLog.js';
import { SessionMetaSchema, type AgentEvent, type AgentEventInput, type SessionMeta } from '../protocol.js';
import { EventNormalizer } from '../agent/EventNormalizer.js';
import { LiveQuery, type AgentRunner } from '../agent/liveQuery.js';
import { buildAgentOptions } from '../agent/agentOptions.js';
import { composePrompt, renderAppContext, writeAppInputs } from '../agent/appContext.js';
import { FakeAgent } from '../fake/FakeAgent.js';
import type { AppSnapshot } from '../protocol.js';

interface LiveSession {
  runner: AgentRunner;
  normalizer: EventNormalizer | null;
  log: EventLog;
  running: boolean;
  idleTimer: NodeJS.Timeout | null;
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`session not found: ${id}`);
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Data rows of a TSV string (header excluded). */
function countRows(tsv: string): number {
  let n = 0;
  for (let i = 0; i < tsv.length; i++) if (tsv.charCodeAt(i) === 10) n++;
  if (tsv.length > 0 && !tsv.endsWith('\n')) n++;
  return Math.max(0, n - 1);
}

export class SessionManager {
  private readonly live = new Map<string, LiveSession>();
  private readonly logs = new Map<string, EventLog>();
  private readonly metas = new Map<string, SessionMeta>();

  get liveCount(): number {
    return this.live.size;
  }

  sessionDir(id: string): string {
    return join(config.sessionsDir, id);
  }

  workspaceDir(id: string): string {
    return join(this.sessionDir(id), 'workspace');
  }

  /** Creates the sessions dir; runs that were active when the backend stopped are marked interrupted. */
  async init(): Promise<void> {
    await mkdir(config.sessionsDir, { recursive: true });
    for (const meta of await this.list()) {
      if (meta.status === 'running') await this.saveMeta({ ...meta, status: 'interrupted', updatedAt: Date.now() });
    }
  }

  async list(): Promise<SessionMeta[]> {
    const entries = await readdir(config.sessionsDir, { withFileTypes: true });
    const metas: SessionMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await this.get(entry.name);
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<SessionMeta | null> {
    if (!SAFE_ID.test(id)) return null;
    const cached = this.metas.get(id);
    if (cached) return cached;
    const file = join(this.sessionDir(id), 'meta.json');
    if (!existsSync(file)) return null;
    try {
      const meta = SessionMetaSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      this.metas.set(id, meta);
      return meta;
    } catch {
      return null;
    }
  }

  async create(req: { dataset: string; title?: string | undefined }): Promise<SessionMeta> {
    const now = Date.now();
    const id = `${now.toString(36)}-${randomUUID().slice(0, 8)}`;
    const workspace = this.workspaceDir(id);
    for (const dir of ['input', 'out', '.claude/skills']) await mkdir(join(workspace, dir), { recursive: true });
    const stamp = new Date(now).toLocaleString('sv-SE').slice(0, 16); // local time, "2026-10-06 07:37"
    const meta: SessionMeta = { id, title: req.title ?? `${req.dataset} ${stamp}`, dataset: req.dataset, createdAt: now, updatedAt: now, status: 'idle' };
    await this.saveMeta(meta);
    return meta;
  }

  async delete(id: string): Promise<boolean> {
    const meta = await this.get(id);
    if (!meta) return false;
    this.closeLive(id);
    this.logs.delete(id);
    this.metas.delete(id);
    await rm(this.sessionDir(id), { recursive: true, force: true });
    return true;
  }

  async log(id: string): Promise<EventLog> {
    let log = this.logs.get(id);
    if (!log) {
      log = await EventLog.open(join(this.sessionDir(id), 'events.jsonl'));
      this.logs.set(id, log);
    }
    return log;
  }

  /** The app's graph export -> workspace/input/nodes.tsv + edges.tsv; meta.graphHash tells the app it is there. */
  async setGraph(id: string, graph: { graphHash: string; nodesTsv: string; edgesTsv: string }): Promise<{ graphHash: string; nodes: number; edges: number }> {
    const meta = await this.get(id);
    if (!meta) throw new NotFoundError(id);
    const input = join(this.workspaceDir(id), 'input');
    await mkdir(input, { recursive: true });
    await writeFile(join(input, 'nodes.tsv'), graph.nodesTsv);
    await writeFile(join(input, 'edges.tsv'), graph.edgesTsv);
    await this.updateMeta(id, (m) => ({ ...m, graphHash: graph.graphHash, updatedAt: Date.now() }));
    return { graphHash: graph.graphHash, nodes: countRows(graph.nodesTsv), edges: countRows(graph.edgesTsv) };
  }

  /**
   * Accepts a user message. With a snapshot, the input files are refreshed and the agent gets the
   * `<app_context>` block in front of the text; the event log keeps the text as typed.
   */
  async postMessage(id: string, text: string, snapshot?: AppSnapshot): Promise<{ messageId: string }> {
    const meta = await this.get(id);
    if (!meta) throw new NotFoundError(id);
    const session = await this.ensureLive(id, meta);
    let prompt = text;
    if (snapshot) {
      const previous = await writeAppInputs(this.workspaceDir(id), snapshot);
      let context = renderAppContext(snapshot, previous);
      if (snapshot.graphHash !== meta.graphHash) {
        context = context.replace(
          '</app_context>',
          `note: the app's graph (hash ${snapshot.graphHash}) is not what was uploaded (${meta.graphHash ?? 'nothing uploaded'}); input/nodes.tsv may be outdated\n</app_context>`
        );
      }
      prompt = composePrompt(text, context);
    }
    const messageId = randomUUID();
    session.log.append({ type: 'user_message', messageId, text });
    await this.updateMeta(id, (m) => ({ ...m, updatedAt: Date.now() }));
    session.normalizer?.noteUserMessage(messageId);
    session.runner.push(prompt, messageId);
    this.touch(id, session);
    return { messageId };
  }

  /** Interrupts the current run; false when the session has no live agent. */
  async interrupt(id: string): Promise<boolean> {
    const session = this.live.get(id);
    if (!session) return false;
    session.normalizer?.noteInterrupt();
    await session.runner.interrupt();
    return true;
  }

  closeAll(): void {
    for (const id of [...this.live.keys()]) this.closeLive(id);
  }

  // --- live agents --------------------------------------------------------------------------------

  private async ensureLive(id: string, meta: SessionMeta): Promise<LiveSession> {
    const existing = this.live.get(id);
    if (existing) return existing;
    const log = await this.log(id);
    const session: LiveSession = { runner: null as unknown as AgentRunner, normalizer: null, log, running: false, idleTimer: null };
    const emit = (event: AgentEventInput, persist = true): void => {
      const stored = log.append(event, persist);
      if (stored.type === 'run_start') session.running = true;
      if (stored.type === 'run_end') session.running = false;
      void this.onEvent(id, stored);
      this.touch(id, session);
    };
    if (config.fake) {
      session.runner = new FakeAgent(emit);
    } else {
      const normalizer = new EventNormalizer(emit, id.slice(0, 8));
      session.normalizer = normalizer;
      session.runner = new LiveQuery(buildAgentOptions(this.workspaceDir(id), meta.sdkSessionId), {
        onMessage: (message) => normalizer.handle(message),
        onExit: (error) => {
          normalizer.handleExit(error);
          if (this.live.get(id) === session) {
            if (session.idleTimer) clearTimeout(session.idleTimer);
            this.live.delete(id);
          }
        }
      });
    }
    this.live.set(id, session);
    return session;
  }

  private closeLive(id: string): void {
    const session = this.live.get(id);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    this.live.delete(id);
    session.runner.close();
  }

  /** Restarts the idle timer; a session is closed when idle for config.idleCloseMs and not running. */
  private touch(id: string, session: LiveSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (session.running) this.touch(id, session);
      else this.closeLive(id);
    }, config.idleCloseMs);
    session.idleTimer.unref();
  }

  private async onEvent(id: string, event: AgentEvent): Promise<void> {
    switch (event.type) {
      case 'init':
        await this.updateMeta(id, (m) => (m.sdkSessionId === event.sdkSessionId ? m : { ...m, sdkSessionId: event.sdkSessionId, updatedAt: Date.now() }));
        break;
      case 'run_start':
        await this.updateMeta(id, (m) => ({ ...m, status: 'running', updatedAt: Date.now() }));
        break;
      case 'run_end':
        await this.updateMeta(id, (m) => ({ ...m, status: event.status === 'success' || event.status === 'max_turns' ? 'idle' : event.status, updatedAt: Date.now() }));
        break;
      default:
        break;
    }
  }

  private async updateMeta(id: string, update: (m: SessionMeta) => SessionMeta): Promise<void> {
    const meta = await this.get(id);
    if (!meta) return;
    const next = update(meta);
    if (next !== meta) await this.saveMeta(next);
  }

  private async saveMeta(meta: SessionMeta): Promise<void> {
    this.metas.set(meta.id, meta);
    await mkdir(this.sessionDir(meta.id), { recursive: true });
    await writeFile(join(this.sessionDir(meta.id), 'meta.json'), JSON.stringify(meta, null, 2));
  }
}
