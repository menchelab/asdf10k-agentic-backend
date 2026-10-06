/**
 * HTTP API (Hono): sessions, messages, interrupt, SSE event stream, workspace files. The app
 * reaches it as `/agent-api/...` through its Vite proxy; see asdf10k/docs/agent-window-plan.md,
 * section 5.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { config } from './config.js';
import { SessionManager } from './sessions/SessionManager.js';
import {
  CreateSessionRequestSchema,
  FeedbackRequestSchema,
  PostMessageRequestSchema,
  PROTOCOL_VERSION,
  PutGraphRequestSchema,
  type AgentEvent,
  type HealthResponse,
  type ReadyPayload
} from './protocol.js';

const pkg = JSON.parse(await readFile(resolve(config.root, 'package.json'), 'utf8')) as { version: string };
const sdkPkg = JSON.parse(await readFile(resolve(config.root, 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')) as { version: string };

const sessions = new SessionManager();
await sessions.init();

const app = new Hono().basePath('/api');

app.use('*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Last-Event-ID'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use('*', async (c, next) => {
  // The app runs with COEP require-corp; needed when it talks to this backend cross-origin.
  c.header('Cross-Origin-Resource-Policy', 'cross-origin');
  await next();
});

app.get('/health', (c) => {
  const body: HealthResponse = {
    ok: true,
    version: pkg.version,
    protocol: PROTOCOL_VERSION,
    sdkVersion: sdkPkg.version,
    fake: config.fake,
    python: existsSync(join(config.pythonBin, 'python')),
    liveSessions: sessions.liveCount
  };
  return c.json(body);
});

app.get('/sessions', async (c) => c.json(await sessions.list()));

app.post('/sessions', async (c) => {
  const parsed = CreateSessionRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  return c.json(await sessions.create(parsed.data), 201);
});

app.get('/sessions/:id', async (c) => {
  const meta = await sessions.get(c.req.param('id'));
  return meta ? c.json(meta) : c.json({ error: 'not found' }, 404);
});

app.delete('/sessions/:id', async (c) => {
  const ok = await sessions.delete(c.req.param('id'));
  return ok ? c.body(null, 204) : c.json({ error: 'not found' }, 404);
});

app.post('/sessions/:id/messages', async (c) => {
  const id = c.req.param('id');
  if (!(await sessions.get(id))) return c.json({ error: 'not found' }, 404);
  const parsed = PostMessageRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  return c.json(await sessions.postMessage(id, parsed.data.text, parsed.data.snapshot), 202);
});

/** The app's graph export (JSON, usually gzipped by the browser) -> input/nodes.tsv + edges.tsv. */
app.put('/sessions/:id/graph', async (c) => {
  const id = c.req.param('id');
  if (!(await sessions.get(id))) return c.json({ error: 'not found' }, 404);
  let body: unknown;
  try {
    const raw = Buffer.from(await c.req.arrayBuffer());
    const text = (c.req.header('content-encoding') ?? '').includes('gzip') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    body = JSON.parse(text);
  } catch (e) {
    return c.json({ error: `unreadable body: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }
  const parsed = PutGraphRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  return c.json(await sessions.setGraph(id, parsed.data));
});

/** What the user did with a card / button; the agent hears it with the next message. */
app.post('/sessions/:id/feedback', async (c) => {
  const id = c.req.param('id');
  if (!(await sessions.get(id))) return c.json({ error: 'not found' }, 404);
  const parsed = FeedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  await sessions.postFeedback(id, parsed.data);
  return c.body(null, 202);
});

app.post('/sessions/:id/interrupt', async (c) => {
  const id = c.req.param('id');
  if (!(await sessions.get(id))) return c.json({ error: 'not found' }, 404);
  return c.json({ interrupted: await sessions.interrupt(id) });
});

/** SSE: replays persisted events after `after` (or Last-Event-ID), sends `ready`, then streams live. */
app.get('/sessions/:id/events', async (c) => {
  const id = c.req.param('id');
  const meta = await sessions.get(id);
  if (!meta) return c.json({ error: 'not found' }, 404);
  // EventSource reconnects with the same URL (stale `after`) but a current Last-Event-ID.
  const afterParam = c.req.header('Last-Event-ID') ?? c.req.query('after');
  const after = afterParam ? Number(afterParam) || 0 : 0;

  return streamSSE(c, async (stream) => {
    const log = await sessions.log(id);
    let last = after;
    const queue: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    let open = true;
    // Subscribe before the replay so nothing emitted during the replay is lost; duplicates are
    // dropped by seq.
    const unsubscribe = log.subscribe((event) => {
      queue.push(event);
      wake?.();
    });
    stream.onAbort(() => {
      open = false;
      unsubscribe();
      wake?.();
    });

    const send = async (event: AgentEvent): Promise<void> => {
      if (event.seq <= last) return;
      last = event.seq;
      await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) });
    };

    for (const event of await log.read(after)) await send(event);
    const ready: ReadyPayload = { lastSeq: last, status: (await sessions.get(id))?.status ?? meta.status };
    await stream.writeSSE({ event: 'ready', data: JSON.stringify(ready) });

    while (open) {
      if (queue.length === 0) {
        await Promise.race([new Promise<void>((res) => (wake = res)), stream.sleep(15_000)]);
        wake = null;
        if (!open) break;
        if (queue.length === 0) {
          await stream.writeSSE({ event: 'ping', data: '' });
          continue;
        }
      }
      const event = queue.shift();
      if (event) await send(event);
    }
  });
});

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/plain; charset=utf-8' // never render agent HTML in the app's origin
};

/** Files from the session workspace (images, tables, downloads). */
app.get('/sessions/:id/files/*', async (c) => {
  const id = c.req.param('id');
  if (!(await sessions.get(id))) return c.json({ error: 'not found' }, 404);
  const path = decodeURIComponent(c.req.path);
  const marker = '/files/';
  const rel = path.slice(path.indexOf(marker) + marker.length);
  const workspace = sessions.workspaceDir(id);
  const abs = resolve(workspace, rel);
  if (!abs.startsWith(workspace + sep)) return c.json({ error: 'forbidden' }, 403);
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile()) return c.json({ error: 'not found' }, 404);
  const buf = await readFile(abs);
  const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return c.body(body, 200, {
    'Content-Type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(buf.byteLength),
    'Cache-Control': 'no-cache'
  });
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`asdf10k-agentic-backend ${pkg.version} on http://localhost:${info.port}/api  (sdk ${sdkPkg.version}${config.fake ? ', FAKE agent' : ''}; sessions in ${config.sessionsDir})`);
});

const shutdown = (): void => {
  sessions.closeAll();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
