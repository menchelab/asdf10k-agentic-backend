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

export const config = {
  root,
  port: Number(process.env.PORT ?? 8787),
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
