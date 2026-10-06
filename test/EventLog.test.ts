import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../src/sessions/EventLog.js';

describe('EventLog', () => {
  const dirs: string[] = [];
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'eventlog-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('keeps seq growing across a reopen even when the last events were not persisted', async () => {
    const file = join(tmp(), 'events.jsonl');
    const log = await EventLog.open(file);
    log.append({ type: 'user_message', messageId: 'm', text: 'hi' });
    for (let i = 0; i < 5; i++) log.append({ type: 'text_delta', runId: 'r', blockId: 'b', text: 'x' }, false);
    const lastSeen = log.lastSeq;
    expect(lastSeen).toBe(6);

    const reopened = await EventLog.open(file);
    const next = reopened.append({ type: 'user_message', messageId: 'm2', text: 'again' });
    expect(next.seq).toBeGreaterThan(lastSeen);
    expect((await reopened.read(0)).map((e) => e.seq)).toEqual([1, next.seq]);
  });

  it('replays persisted events after a seq and notifies subscribers', async () => {
    const log = await EventLog.open(join(tmp(), 'events.jsonl'));
    const seen: number[] = [];
    const unsub = log.subscribe((e) => seen.push(e.seq));
    log.append({ type: 'user_message', messageId: 'a', text: '1' });
    log.append({ type: 'status', state: 'requesting' }, false);
    log.append({ type: 'user_message', messageId: 'b', text: '2' });
    unsub();
    log.append({ type: 'user_message', messageId: 'c', text: '3' });
    expect(seen).toEqual([1, 2, 3]);
    expect((await log.read(1)).map((e) => e.seq)).toEqual([3, 4]);
  });
});
