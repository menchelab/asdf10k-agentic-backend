/**
 * Block ids: the SDK emits one `assistant` message per content block (same `message.id`), while
 * the stream events index blocks within the API message. The final text must land in the block
 * the deltas built, also when a thinking block precedes the text.
 */

import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { EventNormalizer } from '../src/agent/EventNormalizer.js';
import type { AgentEventInput } from '../src/protocol.js';

type Rec = Record<string, unknown>;
const sdk = (m: Rec): SDKMessage => m as unknown as SDKMessage;
const stream = (event: Rec): SDKMessage => sdk({ type: 'stream_event', event, parent_tool_use_id: null, uuid: 'u', session_id: 's' });
const assistant = (id: string, block: Rec): SDKMessage => sdk({ type: 'assistant', message: { id, role: 'assistant', content: [block] }, parent_tool_use_id: null, uuid: Math.random().toString(36), session_id: 's' });

function collect(messages: SDKMessage[]): AgentEventInput[] {
  const events: AgentEventInput[] = [];
  const n = new EventNormalizer((e) => events.push(e), 't');
  n.noteUserMessage('m');
  for (const m of messages) n.handle(m);
  return events;
}

describe('text block ids', () => {
  it('matches the final text to the streamed block after a thinking block', () => {
    const events = collect([
      sdk({ type: 'system', subtype: 'init', session_id: 's', model: 'x', tools: [], skills: [], claude_code_version: '1' }),
      stream({ type: 'message_start', message: { id: 'msg_1' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      stream({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
      stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hel' } }),
      stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'lo' } }),
      stream({ type: 'message_stop' }),
      assistant('msg_1', { type: 'thinking', thinking: '...' }),
      assistant('msg_1', { type: 'text', text: 'Hello' }),
      sdk({ type: 'result', subtype: 'success', duration_ms: 1, num_turns: 1, total_cost_usd: 0, session_id: 's' })
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta');
    const texts = events.filter((e) => e.type === 'text');
    expect(deltas).toHaveLength(2);
    expect(texts).toHaveLength(1);
    const deltaId = deltas[0]?.type === 'text_delta' ? deltas[0].blockId : '';
    expect(texts[0]?.type === 'text' && texts[0].blockId).toBe(deltaId);
  });

  it('gives two API messages of one run distinct block ids, with and without streaming', () => {
    const events = collect([
      stream({ type: 'message_start', message: { id: 'msg_1' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } }),
      assistant('msg_1', { type: 'text', text: 'A' }),
      // second message arrives without stream events
      assistant('msg_2', { type: 'text', text: 'B' }),
      assistant('msg_2', { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } })
    ]);
    const texts = events.filter((e) => e.type === 'text').map((e) => (e.type === 'text' ? [e.blockId, e.text] : []));
    expect(texts).toHaveLength(2);
    expect(texts[0]?.[0]).not.toBe(texts[1]?.[0]);
    expect(texts[0]?.[0]).toBe(texts[0]?.[0]?.replace(/:\d+:0$/, ':1:0'));
    expect(texts[1]?.[0]?.startsWith('t-r1:2:')).toBe(true);
    expect(events.filter((e) => e.type === 'tool_start')).toHaveLength(1);
  });
});
