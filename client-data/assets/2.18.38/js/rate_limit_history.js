/** Flat time/cost pairs avoid a separate object for each emission.
 * @typedef {{entries: number[], first: number, total: number}} RateLimitHistory */

/** Retain only numeric emission times and costs, never drawing messages.
 * @param {RateLimitHistory | null} history @param {number} cost @param {number} now
 * @returns {RateLimitHistory} */
export function recordRateLimitUsage(history, cost, now) {
  history ||= { entries: [], first: 0, total: 0 };
  history.entries.push(now, cost);
  history.total += cost;
  return history;
}

/** A client cannot know where the server's fixed windows start. Bound usage
 * across every interval instead of resetting a separate local allowance.
 * @param {RateLimitHistory | null} history @param {number} cost
 * @param {number} limit @param {number} periodMs @param {number} now */
export function getRateLimitHistoryWaitMs(history, cost, limit, periodMs, now) {
  if (!history) return 0;
  const entries = history.entries;
  while (
    history.first < entries.length &&
    /** @type {number} */ (entries[history.first]) + periodMs <= now
  ) {
    history.total -= /** @type {number} */ (entries[history.first + 1]);
    history.first += 2;
  }
  // Compact occasionally, avoiding an allocation for each emitted point.
  if (history.first >= 64 && history.first * 2 >= entries.length) {
    entries.splice(0, history.first);
    history.first = 0;
  }
  // A single operation larger than the allowance cannot be paced. Preserve
  // authoritative server admission instead of holding that operation forever.
  if (cost > limit) return 0;
  let needed = history.total + cost - limit;
  if (needed <= 0) return 0;
  for (let i = history.first; i < entries.length; i += 2) {
    needed -= /** @type {number} */ (entries[i + 1]);
    if (needed <= 0) return /** @type {number} */ (entries[i]) + periodMs - now;
  }
  return periodMs;
}
