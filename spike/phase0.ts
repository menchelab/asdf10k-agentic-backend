/**
 * Phase 0 spike: confirm the Agent SDK behaviour the backend relies on (see
 * ../asdf10k/docs/agent-window-plan.md, section 10, phase 0).
 *
 *   npx tsx spike/phase0.ts
 *
 * One long-lived query in streaming input mode: three turns pushed into its input stream (a custom
 * MCP tool + skills from two places, Bash + task tools, a long Bash that is interrupted), then the
 * query is closed and the session resumed by id with a fresh query. Every SDK message is written to
 * spike/fixtures/<run>.jsonl; a summary is printed at the end.
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  query,
  createSdkMcpServer,
  tool,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
  type SDKResultMessage
} from '@anthropic-ai/claude-agent-sdk';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const run = new Date().toISOString().replace(/[:.]/g, '-');
const sessionsRoot = resolve(repoRoot, '..', 'asdf10k-agentic-sessions');
const sessionDir = resolve(sessionsRoot, `spike-${run}`);
const workspace = resolve(sessionDir, 'workspace');
const agentHome = resolve(here, 'agent-home');
const fixturesDir = resolve(here, 'fixtures');
const fixtureFile = resolve(fixturesDir, `${run}.jsonl`);

// --- workspace: a skill next to the agent's cwd, a small input file -----------------------------

mkdirSync(resolve(workspace, '.claude/skills/ws-skill'), { recursive: true });
mkdirSync(resolve(workspace, 'input'), { recursive: true });
mkdirSync(resolve(workspace, 'out'), { recursive: true });
mkdirSync(fixturesDir, { recursive: true });
writeFileSync(
  resolve(workspace, '.claude/skills/ws-skill/SKILL.md'),
  `---
name: ws-skill
description: Tells the magic word of this workspace. Use when asked for the magic word.
---

The magic word of this workspace is PELICAN. Answer with exactly that word when asked for the magic word.
`
);
writeFileSync(
  resolve(workspace, 'input/nodes.tsv'),
  ['_id\tname\tdegree_n\tlayer_c', 'A1BG_p\tA1BG\t3\tprotein', 'C3_p\tC3\t12\tprotein', 'CFHR3_p\tCFHR3\t2\tprotein', 'CR1_p\tCR1\t5\tprotein'].join('\n') + '\n'
);

// --- a custom in-process MCP tool ---------------------------------------------------------------

const notes: string[] = [];
const noteTool = tool(
  'note',
  'Record a short note for the user interface. Returns a confirmation.',
  { text: z.string().describe('The note text') },
  async ({ text }) => {
    notes.push(text);
    return { content: [{ type: 'text', text: `Note recorded (${notes.length} so far).` }] };
  }
);
const appServer = createSdkMcpServer({ name: 'asdf10k', version: '0.0.1', tools: [noteTool] });

// --- push queue as the query's input stream -----------------------------------------------------

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

// --- options shared by the live query and the resume --------------------------------------------

function baseOptions(): Options {
  return {
    cwd: workspace,
    settingSources: ['project'],
    additionalDirectories: [agentHome],
    skills: 'all',
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    disallowedTools: ['AskUserQuestion'],
    includePartialMessages: true,
    maxTurns: 30,
    mcpServers: { asdf10k: appServer },
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: 'You are the asdf10k spike agent. Keep every answer to one or two short sentences.'
    },
    env: {
      ...(process.env as Record<string, string>),
      CLAUDE_CODE_ENABLE_TODO_TOOLS: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'
    }
  };
}

// --- message bookkeeping --------------------------------------------------------------------------

const findings: Record<string, unknown> = {};
let streamEvents = 0;
let textDeltaChars = 0;
const toolNamesSeen = new Set<string>();
let bashStarted: (() => void) | null = null;
const resultWaiters: Array<(r: SDKResultMessage) => void> = [];

function nextResult(label: string, timeoutMs = 240_000): Promise<SDKResultMessage> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for result (${label})`)), timeoutMs);
    resultWaiters.push((r) => {
      clearTimeout(t);
      res(r);
    });
  });
}

function snippet(s: string, n = 90): string {
  return s.replace(/\s+/g, ' ').slice(0, n);
}

function record(tag: string, msg: SDKMessage): void {
  // stream events are many; keep the fixture readable by storing only the first 40 of them
  if (msg.type !== 'stream_event' || streamEvents <= 40) appendFileSync(fixtureFile, JSON.stringify({ tag, msg }) + '\n');
  const m = msg as unknown as Record<string, unknown>;
  switch (msg.type) {
    case 'system': {
      if ((m.subtype as string) === 'init') {
        findings.init = {
          claude_code_version: m.claude_code_version,
          model: m.model,
          apiKeySource: m.apiKeySource,
          cwd: m.cwd,
          tools: m.tools,
          mcp_servers: m.mcp_servers,
          skills: m.skills,
          slash_commands: m.slash_commands,
          session_id: m.session_id,
          permissionMode: m.permissionMode
        };
        console.log(`[${tag}] init: model=${String(m.model)} cc=${String(m.claude_code_version)} apiKeySource=${String(m.apiKeySource)} session=${String(m.session_id)}`);
        console.log(`[${tag}]   tools: ${(m.tools as string[]).join(', ')}`);
        console.log(`[${tag}]   skills: ${JSON.stringify(m.skills)}  mcp: ${JSON.stringify(m.mcp_servers)}`);
      } else {
        console.log(`[${tag}] system/${String(m.subtype)}`);
      }
      break;
    }
    case 'assistant': {
      const content = (m.message as { content: Array<Record<string, unknown>> }).content;
      for (const b of content) {
        if (b.type === 'text') console.log(`[${tag}] assistant text: ${snippet(b.text as string)}`);
        else if (b.type === 'tool_use') {
          toolNamesSeen.add(b.name as string);
          console.log(`[${tag}] assistant tool_use ${String(b.name)} id=${String(b.id)} input=${snippet(JSON.stringify(b.input))}`);
          if (b.name === 'Bash' && bashStarted) {
            bashStarted();
            bashStarted = null;
          }
        } else if (b.type === 'thinking') console.log(`[${tag}] assistant thinking (${String((b.thinking as string | undefined)?.length ?? 0)} chars)`);
        else console.log(`[${tag}] assistant block ${String(b.type)}`);
      }
      break;
    }
    case 'user': {
      const content = (m.message as { content: unknown }).content;
      if (Array.isArray(content)) {
        for (const b of content as Array<Record<string, unknown>>) {
          if (b.type === 'tool_result') {
            const r = m.tool_use_result;
            console.log(`[${tag}] tool_result for ${String(b.tool_use_id)} is_error=${String(b.is_error ?? false)} tool_use_result=${snippet(JSON.stringify(r) ?? 'undefined', 160)}`);
          } else console.log(`[${tag}] user block ${String(b.type)}`);
        }
      } else console.log(`[${tag}] user text: ${snippet(String(content))}`);
      break;
    }
    case 'stream_event': {
      streamEvents++;
      const ev = m.event as Record<string, unknown>;
      if (ev.type === 'content_block_delta') {
        const d = ev.delta as Record<string, unknown>;
        if (d.type === 'text_delta') textDeltaChars += (d.text as string).length;
      }
      if (streamEvents <= 6) console.log(`[${tag}] stream_event ${String(ev.type)} ${snippet(JSON.stringify(ev), 120)}`);
      break;
    }
    case 'result': {
      console.log(
        `[${tag}] result subtype=${String(m.subtype)} turns=${String(m.num_turns)} ms=${String(m.duration_ms)} cost=${String(m.total_cost_usd)} queued=${String(m.queued_turn_count)} stop=${String(m.stop_reason)}${m.is_error ? ' is_error' : ''}`
      );
      if (typeof m.result === 'string') console.log(`[${tag}]   result text: ${snippet(m.result as string, 200)}`);
      if (Array.isArray(m.errors) && (m.errors as string[]).length) console.log(`[${tag}]   errors: ${(m.errors as string[]).join(' | ')}`);
      resultWaiters.shift()?.(msg as SDKResultMessage);
      break;
    }
    default:
      console.log(`[${tag}] ${msg.type}${m.subtype ? '/' + String(m.subtype) : ''} ${snippet(JSON.stringify(m), 100)}`);
  }
}

// --- the spike ----------------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`workspace: ${workspace}`);
  console.log(`fixture:   ${fixtureFile}`);
  const t0 = Date.now();

  const input = new InputQueue();
  const q = query({ prompt: input, options: baseOptions() });
  const reader = (async () => {
    try {
      for await (const msg of q) record('live', msg);
    } catch (e) {
      console.log(`[live] reader ended with error: ${String(e)}`);
      findings.liveReaderError = String(e);
    }
  })();

  // Turn 1: custom MCP tool + a skill from the workspace + a skill from agent-home.
  input.push(
    'First call the tool "note" with the text "hello from spike". Then tell me the magic word (use the ws-skill skill) and the lab animal (use the home-skill skill). Answer in one line: "magic word: X, lab animal: Y".'
  );
  const r1 = await nextResult('turn 1');
  findings.turn1 = { subtype: r1.subtype, result: (r1 as unknown as { result?: string }).result, notes: [...notes], ms: r1.duration_ms };

  // Turn 2: Bash under bypassPermissions + task tools.
  input.push(
    'Create a task list with two items ("count rows", "report") and work through it: use Bash to count the data rows in input/nodes.tsv (exclude the header), then report the number in one sentence.'
  );
  const r2 = await nextResult('turn 2');
  findings.turn2 = { subtype: r2.subtype, result: (r2 as unknown as { result?: string }).result, ms: r2.duration_ms, toolsSeen: [...toolNamesSeen] };

  // Turn 3: long Bash, interrupted 3 s after it starts.
  const bashSeen = new Promise<void>((res) => {
    bashStarted = res;
  });
  input.push('Run exactly this with Bash and nothing else before it: sleep 40 && echo finished. Then say "done".');
  const raced = await Promise.race([bashSeen.then(() => 'bash'), nextResult('turn 3 early result').then(() => 'result')]);
  if (raced === 'bash') {
    await new Promise((res) => setTimeout(res, 3000));
    const tInt = Date.now();
    const intResp = await q.interrupt();
    console.log(`[live] interrupt() returned after ${Date.now() - tInt} ms: ${snippet(JSON.stringify(intResp), 160)}`);
    const r3 = await nextResult('turn 3 after interrupt');
    findings.turn3 = { subtype: r3.subtype, is_error: (r3 as unknown as { is_error?: boolean }).is_error, result: (r3 as unknown as { result?: string }).result, ms: r3.duration_ms, interruptMs: Date.now() - tInt, stop_reason: (r3 as unknown as { stop_reason?: string }).stop_reason };
  } else {
    findings.turn3 = { note: 'result arrived before Bash started; interrupt not tested' };
  }

  const sdkSessionId = (findings.init as { session_id?: string } | undefined)?.session_id ?? r1.session_id;
  findings.sdkSessionId = sdkSessionId;
  findings.streamEvents = streamEvents;
  findings.textDeltaChars = textDeltaChars;

  // Close the live query (what the idle timeout will do), then resume the session by id.
  input.end();
  q.close();
  await Promise.race([reader, new Promise((res) => setTimeout(res, 5000))]);
  console.log(`[live] closed after ${Date.now() - t0} ms`);

  const tR = Date.now();
  let resumeText = '';
  try {
    for await (const msg of query({
      prompt: 'Without using any tool: what was the magic word you told me earlier in this conversation? Answer with one word.',
      options: { ...baseOptions(), resume: sdkSessionId, includePartialMessages: false }
    })) {
      record('resume', msg);
      if (msg.type === 'result' && (msg as unknown as { result?: string }).result) resumeText = (msg as unknown as { result: string }).result;
    }
  } catch (e) {
    console.log(`[resume] ended with error: ${String(e)}`);
    findings.resumeError = String(e);
  }
  findings.resume = { ms: Date.now() - tR, text: resumeText, remembered: /pelican/i.test(resumeText) };

  console.log('\n===== findings =====');
  console.log(JSON.stringify(findings, null, 2));
  writeFileSync(resolve(fixturesDir, `${run}-findings.json`), JSON.stringify(findings, null, 2));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
