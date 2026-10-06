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
  /** A run without any SDK message for this long gets `status: waiting` events (every check), and is stopped after stallAbortMs. */
  stallWarnMs: Math.max(10, Number(process.env.RUN_STALL_WARN_S ?? 90) || 90) * 1000,
  stallAbortMs: Math.max(1, Number(process.env.RUN_STALL_ABORT_MIN ?? 10) || 10) * 60_000,
  /** Speech to text for the push-to-talk button (WHISPER_* in .env.example). */
  whisper: resolveWhisperConfig(process.env, root)
};
