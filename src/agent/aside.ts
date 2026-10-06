/**
 * "What's up?": a side question to a running (or stalled) session without touching its run. The
 * SDK session is forked at its current transcript (`forkSession`), asked one question with no
 * tools and one turn, and the fork is discarded. Works while the main run waits for the model,
 * because it is a separate process and request. SessionManager.aside wraps it and logs an `aside`
 * event; the window shows the answer under the run.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildAgentOptions } from './agentOptions.js';
import { config } from '../config.js';

export const DEFAULT_ASIDE_QUESTION = "What's up? In two or three short sentences: what have you done so far in this run, what are you doing right now, and what is left?";

const ASIDE_APPEND = `This is a side question from the user while your main run continues (or waits). Answer from the conversation so far in at most three short plain sentences, no tools, no markdown headings, no new work. If the last step finished and nothing else happened yet, say that you are waiting for the model's next step.`;

const ASIDE_TIMEOUT_MS = 90_000;

export async function runAside(workspace: string, sdkSessionId: string, question: string): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ASIDE_TIMEOUT_MS);
  try {
    const base = buildAgentOptions(workspace, sdkSessionId, {});
    const q = query({
      prompt: question,
      options: {
        ...base,
        forkSession: true,
        maxTurns: 1,
        model: config.asideModel, // a status summary: the small fast model is enough
        effort: 'low',
        tools: [],
        includePartialMessages: false,
        abortController: abort,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: ASIDE_APPEND }
      }
    });
    let text = '';
    for await (const m of q) {
      if (m.type === 'assistant') {
        const content = m.message.content;
        if (Array.isArray(content)) for (const c of content) if (c.type === 'text') text += c.text;
      } else if (m.type === 'result') {
        if (m.subtype === 'success' && typeof m.result === 'string' && m.result.trim()) text = m.result;
        break;
      }
    }
    const answer = text.replace(/\s+/g, ' ').trim();
    if (!answer) throw new Error('no answer');
    return answer;
  } finally {
    clearTimeout(timer);
  }
}
