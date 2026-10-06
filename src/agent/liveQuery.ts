/**
 * One live Claude Code process for a session: a `query()` in streaming input mode whose prompt is
 * a push queue. User messages are pushed in; every SDK message goes to `onMessage`. Closed after
 * an idle time by the SessionManager; the next message resumes the session by id.
 */

import type { UUID } from 'node:crypto';
import { query, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** What the SessionManager needs from an agent, real (LiveQuery) or scripted (FakeAgent). */
export interface AgentRunner {
  /** Push a user message. `messageId` lets the result be linked back to it (SDK `user_message_uuids`). */
  push(text: string, messageId: UUID): void;
  interrupt(): Promise<void>;
  close(): void;
  /** Re-read the skills from disk (after the generated catalog skill was rewritten). */
  reloadSkills?(): Promise<void>;
}

export interface LiveQueryHandlers {
  onMessage: (message: SDKMessage) => void;
  /** The SDK stream ended: `error` is null after close(), otherwise the reason (process exit, crash). */
  onExit: (error: unknown) => void;
}

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private readonly waiters: Array<(r: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

  push(message: SDKUserMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.items.push(message);
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

export class LiveQuery implements AgentRunner {
  private readonly input = new InputQueue();
  private readonly q: Query;
  private closed = false;

  constructor(options: Options, handlers: LiveQueryHandlers) {
    const q = query({ prompt: this.input, options });
    this.q = q;
    void (async () => {
      let error: unknown = null;
      try {
        for await (const message of q) handlers.onMessage(message);
      } catch (e) {
        if (!this.closed) error = e;
      }
      handlers.onExit(error);
    })();
  }

  push(text: string, messageId: UUID): void {
    if (this.closed) throw new Error('live query is closed');
    this.input.push({ type: 'user', uuid: messageId, message: { role: 'user', content: text }, parent_tool_use_id: null });
  }

  async interrupt(): Promise<void> {
    if (this.closed) return;
    await this.q.interrupt();
  }

  async reloadSkills(): Promise<void> {
    if (this.closed) return;
    await this.q.reloadSkills();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.input.end();
    this.q.close();
  }
}
