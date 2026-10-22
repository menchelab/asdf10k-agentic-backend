/**
 * Per-run cost from the SDK's running total. A result's `total_cost_usd` is the conversation's
 * total so far (the recorded fixture: 0.083, 0.152, 0.177, ... over one live session), so a run's
 * own cost is the difference to the previous result. A session reopened after a restart starts
 * from the last total in its log (`run_end.sessionCostUsd`); a total below the base means the SDK
 * counter started over, and the run's cost is the total itself.
 */
export class RunCost {
  constructor(private base = 0) {}

  /** The run's cost for an SDK total, and the total (rounded to 1e-6 against float noise). */
  next(total: number): { costUsd: number; sessionCostUsd: number } {
    const t = Number.isFinite(total) && total > 0 ? total : 0;
    const delta = t >= this.base ? t - this.base : t;
    this.base = t;
    return { costUsd: Math.round(delta * 1e6) / 1e6, sessionCostUsd: Math.round(t * 1e6) / 1e6 };
  }
}

/** The base for a reopened session from its log: the last `sessionCostUsd`, else (logs before it) the largest `costUsd` - those were running totals. */
export function costBaseFromLog(events: ReadonlyArray<{ type: string; costUsd?: number | undefined; sessionCostUsd?: number | undefined }>): number {
  let base = 0;
  let legacyMax = 0;
  for (const e of events) {
    if (e.type !== 'run_end') continue;
    if (typeof e.sessionCostUsd === 'number') base = e.sessionCostUsd;
    else if (typeof e.costUsd === 'number') legacyMax = Math.max(legacyMax, e.costUsd);
  }
  return base || legacyMax;
}
