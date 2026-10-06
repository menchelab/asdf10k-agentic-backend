/**
 * Phase 0 spike, part 2: interrupt a running tool call, then queue two messages.
 *
 *   npx tsx spike/interrupt.ts
 *
 * Findings go to spike/fixtures/<run>-interrupt.jsonl / -findings.json.
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, type Options, type SDKMessage, type SDKUserMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const run = new Date().toISOString().replace(/[:.]/g, '-');
const workspace = resolve(repoRoot, '..', 'asdf10k-agentic-sessions', `spike-int-${run}`, 'workspace');
const fixturesDir = resolve(here, 'fixtures');
const fixtureFile = resolve(fixturesDir, `${run}-interrupt.jsonl`);
mkdirSync(workspace, { recursive: true });
mkdirSync(fixturesDir, { recursive: true });

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: Array<(r: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;
  push(text: string): void {
    const msg: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    const w = this.waiters.shift();
    if (w) w({ value: msg, done: false });
    else this.items.push(msg);
  }
  end(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as unknown as SDKUserMessage, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
        return new Promise((res) => this.waiters.push(res));
      }
    };
  }
}

const options: Options = {
  cwd: workspace,
  settingSources: ['project'],
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  disallowedTools: ['AskUserQuestion'],
  includePartialMessages: false,
  maxTurns: 30,
  strictMcpConfig: true,
  settings: { disableClaudeAiConnectors: true },
  systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Keep every answer to one short sentence.' },
  env: { ...(process.env as Record<string, string>), CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }
};

const t0 = Date.now();
const ms = (): string => String(Date.now() - t0).padStart(6, ' ');
const findings: Record<string, unknown> = {};
const results: SDKResultMessage[] = [];
let resultListeners: Array<() => void> = [];
let bashStarted: ((id: string) => void) | null = null;
const toolResults: Array<{ id: string; is_error: unknown; text: string; structured: unknown; at: number }> = [];

/** Resolves with results[index] as soon as it exists (no waiter is left behind when a race loses). */
function resultAt(index: number, label: string, timeoutMs = 180_000): Promise<SDKResultMessage> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout: ${label}`)), timeoutMs);
    const check = (): boolean => {
      const r = results[index];
      if (!r) return false;
      clearTimeout(t);
      res(r);
      return true;
    };
    if (!check()) resultListeners.push(() => check());
  });
}
const snip = (s: unknown, n = 140): string => JSON.stringify(s)?.replace(/\s+/g, ' ').slice(0, n) ?? 'undefined';

function record(msg: SDKMessage): void {
  appendFileSync(fixtureFile, JSON.stringify({ at: Date.now() - t0, msg }) + '\n');
  const m = msg as unknown as Record<string, unknown>;
  if (msg.type === 'assistant') {
    for (const b of (m.message as { content: Array<Record<string, unknown>> }).content) {
      if (b.type === 'text') console.log(`${ms()} assistant: ${snip(b.text)}`);
      else if (b.type === 'tool_use') {
        console.log(`${ms()} tool_use ${String(b.name)} ${snip(b.input)}`);
        if (b.name === 'Bash' && bashStarted) {
          bashStarted(b.id as string);
          bashStarted = null;
        }
      }
    }
  } else if (msg.type === 'user') {
    const c = (m.message as { content: unknown }).content;
    if (Array.isArray(c)) {
      for (const b of c as Array<Record<string, unknown>>) {
        if (b.type === 'tool_result') {
          const text = snip(b.content, 160);
          toolResults.push({ id: b.tool_use_id as string, is_error: b.is_error, text, structured: m.tool_use_result, at: Date.now() - t0 });
          console.log(`${ms()} tool_result is_error=${String(b.is_error)} ${text} | structured=${snip(m.tool_use_result, 120)}`);
        }
      }
    } else console.log(`${ms()} USER: ${snip(c)}`);
  } else if (msg.type === 'result') {
    console.log(`${ms()} RESULT ${String(m.subtype)} turns=${String(m.num_turns)} stop=${String(m.stop_reason)} is_error=${String(m.is_error)} queued=${String(m.queued_turn_count)} result=${snip(m.result, 120)}`);
    results.push(msg as SDKResultMessage);
    const ls = resultListeners;
    resultListeners = [];
    for (const l of ls) l();
  } else if (msg.type === 'system' && (m.subtype as string) !== 'status') {
    console.log(`${ms()} system/${String(m.subtype)} ${snip({ ...m, type: undefined, uuid: undefined, session_id: undefined, tools: undefined, slash_commands: undefined, skills: undefined }, 160)}`);
  } else if (msg.type !== 'system' && msg.type !== 'stream_event') {
    console.log(`${ms()} ${msg.type}${m.subtype ? '/' + String(m.subtype) : ''} ${snip(m, 100)}`);
  }
}

async function main(): Promise<void> {
  const input = new InputQueue();
  const q = query({ prompt: input, options });
  const reader = (async () => {
    try {
      for await (const msg of q) record(msg);
    } catch (e) {
      console.log(`${ms()} reader error: ${String(e)}`);
      findings.readerError = String(e);
    }
  })();

  // A: a long-running foreground tool call, interrupted 3 s after it starts.
  const bashSeen = new Promise<string>((res) => {
    bashStarted = res;
  });
  input.push('Run this with Bash in the foreground (not in the background): python3 -c "import time; time.sleep(45); print(\'slept\')" and then tell me what it printed.');
  const first = await Promise.race([bashSeen.then((id) => ({ kind: 'bash', id })), resultAt(0, 'A early').then(() => ({ kind: 'result', id: '' }))]);
  if (first.kind === 'bash') {
    await new Promise((res) => setTimeout(res, 3000));
    const tInt = Date.now();
    const intResp = await q.interrupt();
    const interruptReturnMs = Date.now() - tInt;
    console.log(`${ms()} interrupt() returned after ${interruptReturnMs} ms: ${snip(intResp, 160)}`);
    const rA = await resultAt(0, 'A after interrupt', 60_000).catch((e: Error) => e);
    findings.A = {
      bashToolUseId: first.id,
      interruptReturnMs,
      interruptResponse: intResp,
      resultAfterInterrupt: rA instanceof Error ? rA.message : { subtype: rA.subtype, is_error: (rA as unknown as { is_error: boolean }).is_error, stop_reason: (rA as unknown as { stop_reason: string }).stop_reason, result: (rA as unknown as { result?: string }).result, msAfterInterrupt: Date.now() - tInt },
      toolResultForBash: toolResults.find((t) => t.id === first.id) ?? null
    };
  } else {
    findings.A = { note: 'result arrived before Bash started' };
  }

  // B: is the session still usable after the interrupt?
  const tB = Date.now();
  input.push('Reply with the single word OK.');
  const rB = await resultAt(1, 'B');
  findings.B = { subtype: rB.subtype, result: (rB as unknown as { result?: string }).result, msFromPushToResult: Date.now() - tB };

  // C + D: two messages pushed back to back; the second should queue.
  const tC = Date.now();
  input.push('Use Bash to run: python3 -c "import time; time.sleep(6); print(\'c\')" and report what it printed.');
  await new Promise((res) => setTimeout(res, 1500));
  input.push('What is 2 + 2? Answer with the number only.');
  const rC = await resultAt(2, 'C');
  const rD = await resultAt(3, 'D', 60_000).catch((e: Error) => e);
  findings.CD = {
    C: { subtype: rC.subtype, queued_turn_count: (rC as unknown as { queued_turn_count?: number }).queued_turn_count, result: (rC as unknown as { result?: string }).result, ms: Date.now() - tC },
    D: rD instanceof Error ? rD.message : { subtype: rD.subtype, result: (rD as unknown as { result?: string }).result, num_turns: rD.num_turns },
    resultsTotal: results.length
  };

  input.end();
  q.close();
  await Promise.race([reader, new Promise((res) => setTimeout(res, 3000))]);
  console.log('\n===== findings =====');
  console.log(JSON.stringify(findings, null, 2));
  writeFileSync(resolve(fixturesDir, `${run}-interrupt-findings.json`), JSON.stringify(findings, null, 2));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
