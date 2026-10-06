/**
 * Append-only event log of one session (`events.jsonl`) with live subscribers. Every event gets
 * a sequence number, also the ones that are not written to disk (text deltas, status), so a
 * client can resume with `after=<seq>` and a replay never repeats what it has seen.
 */

import { appendFileSync, createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { AgentEvent, AgentEventInput } from '../protocol.js';

type Listener = (event: AgentEvent) => void;

/**
 * Gap added to the sequence after a restart. Unpersisted events (deltas, status) also take
 * sequence numbers, so the counter is kept in a sidecar file; the gap covers a crash between
 * the increment and that write. Clients only require seq to grow, gaps are fine.
 */
const RESTART_GAP = 1000;

export class EventLog {
  private seq: number;
  private readonly seqFile: string;
  private readonly listeners = new Set<Listener>();

  private constructor(
    private readonly file: string,
    lastSeq: number
  ) {
    this.seq = lastSeq;
    this.seqFile = `${file}.seq`;
  }

  static async open(file: string): Promise<EventLog> {
    let last = 0;
    if (existsSync(file)) {
      for await (const line of lines(file)) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as { seq?: number };
          if (typeof e.seq === 'number' && e.seq > last) last = e.seq;
        } catch {
          // skip a damaged line
        }
      }
    }
    const seqFile = `${file}.seq`;
    if (existsSync(seqFile)) {
      const stored = Number(readFileSync(seqFile, 'utf8'));
      if (Number.isFinite(stored) && stored > last) last = stored;
    }
    return new EventLog(file, last === 0 ? 0 : last + RESTART_GAP);
  }

  get lastSeq(): number {
    return this.seq;
  }

  append(input: AgentEventInput, persist = true): AgentEvent {
    const event = { ...input, seq: ++this.seq, ts: Date.now() } as AgentEvent;
    writeFileSync(this.seqFile, String(this.seq));
    if (persist) appendFileSync(this.file, JSON.stringify(event) + '\n');
    for (const l of [...this.listeners]) l(event);
    return event;
  }

  /** Persisted events with seq > afterSeq, in order. */
  async read(afterSeq: number): Promise<AgentEvent[]> {
    const out: AgentEvent[] = [];
    if (!existsSync(this.file)) return out;
    for await (const line of lines(this.file)) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as AgentEvent;
        if (e.seq > afterSeq) out.push(e);
      } catch {
        // skip a damaged line
      }
    }
    return out;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

function lines(file: string): AsyncIterable<string> {
  return createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
}
