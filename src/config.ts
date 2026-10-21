/** Environment configuration (see .env.example). */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveWhisperConfig } from './transcribe/whisper.js';

const root = resolve(import.meta.dirname, '..');

try {
  const envFile = resolve(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
} catch {
  // .env is optional
}

function parsePort(raw: string | undefined): number {
  const n = Number(raw);
  if (raw && (!Number.isInteger(n) || n < 1 || n > 65535)) console.warn(`AGENT_PORT="${raw}" is not a port; using 8787`);
  return raw && Number.isInteger(n) && n > 0 && n < 65536 ? n : 8787;
}

/** An IPv4 / IPv6 address or a plain host name; anything else (e.g. a conda platform triple) falls back to 127.0.0.1. */
function parseHost(raw: string | undefined): string {
  const v = raw?.trim();
  if (!v) return '127.0.0.1';
  const ok = /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || /^[0-9a-f:]+$/i.test(v) || v === 'localhost' || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
  if (!ok) console.warn(`AGENT_HOST="${v}" is not an address; listening on 127.0.0.1`);
  return ok ? v : '127.0.0.1';
}

export const config = {
  root,
  /** AGENT_PORT (own name: PORT / HOST are set by conda, PaaS hosts and shells for other purposes). */
  port: parsePort(process.env.AGENT_PORT),
  /** Interface to listen on. Default 127.0.0.1: there is no authentication, so other machines only get in when AGENT_HOST is set (0.0.0.0) on purpose or through a reverse proxy. */
  host: parseHost(process.env.AGENT_HOST),
  /** AGENT_APP_URL (optional): the app's address, so the start-up hints print full links (src/connectHints.ts). */
  appUrl: process.env.AGENT_APP_URL?.trim() || undefined,
  /** Sessions live outside the repo: Claude Code reads .claude/ and CLAUDE.md from every parent of cwd. */
  sessionsDir: resolve(root, process.env.SESSIONS_DIR ?? '../asdf10k-agentic-sessions'),
  idleCloseMs: Number(process.env.IDLE_CLOSE_MIN ?? 15) * 60_000,
  fake: process.env.AGENT_FAKE === '1',
  /** Static skills for every session (`agent-home/.claude/skills`), loaded via additionalDirectories. */
  agentHome: resolve(root, 'agent-home'),
  pythonBin: resolve(root, 'python/.venv/bin'),
  /** Model and reasoning effort of the session agent (AGENT_MODEL, AGENT_EFFORT) and of the "What's up?" side query (ASIDE_MODEL). Sonnet 5.5 at medium effort answers most app questions in a third of Opus' time. */
  agentModel: process.env.AGENT_MODEL?.trim() || 'claude-sonnet-5-5',
  agentEffort: (process.env.AGENT_EFFORT?.trim() || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  asideModel: process.env.ASIDE_MODEL?.trim() || 'claude-haiku-4-5-20251001',
  /** A run without any SDK message for this long gets `status: waiting` events (every check), and is stopped after stallAbortMs. */
  stallWarnMs: Math.max(10, Number(process.env.RUN_STALL_WARN_S ?? 90) || 90) * 1000,
  stallAbortMs: Math.max(1, Number(process.env.RUN_STALL_ABORT_MIN ?? 10) || 10) * 60_000,
  /** Speech to text for the push-to-talk button (WHISPER_* in .env.example). */
  whisper: resolveWhisperConfig(process.env, root)
};
