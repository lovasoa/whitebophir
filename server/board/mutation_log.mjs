/** @typedef {import("../../types/server-runtime.d.ts").MutationLogEntry} MutationLogEntry */

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeSeq(value) {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : 0;
}

/**
 * @param {number} initialSeq
 * @returns {{
 *   latestSeq: () => number,
 *   persistedSeq: () => number,
 *   minReplayableSeq: () => number,
 *   append: (entry: Omit<MutationLogEntry, "seq">) => MutationLogEntry,
 *   readFrom: (fromExclusiveSeq: number) => MutationLogEntry[],
 *   markPersisted: (persistedSeq: number) => void,
 *   trimPersistedOlderThan: (cutoffMs: number, pinnedBaselineSeq?: number | null) => void,
 *   trimBefore: (seqInclusiveFloor: number) => void,
 * }}
 */
function createMutationLog(initialSeq = 0) {
  let latestSeq = normalizeSeq(initialSeq);
  let persistedSeq = latestSeq;
  /** @type {MutationLogEntry[]} */
  let entries = [];

  return {
    latestSeq() {
      return latestSeq;
    },
    persistedSeq() {
      return persistedSeq;
    },
    minReplayableSeq() {
      const firstEntry = entries[0];
      return firstEntry ? Math.max(0, firstEntry.seq - 1) : latestSeq;
    },
    append(entry) {
      const nextEntry = {
        seq: latestSeq + 1,
        acceptedAtMs: entry.acceptedAtMs,
        mutation: entry.mutation,
      };
      entries.push(nextEntry);
      latestSeq = nextEntry.seq;
      return nextEntry;
    },
    readFrom(fromExclusiveSeq) {
      const fromSeq = normalizeSeq(fromExclusiveSeq);
      const firstEntry = entries[0];
      if (!firstEntry || fromSeq >= latestSeq) return [];
      // Entries are always a contiguous suffix, so seq arithmetic gives the offset.
      const start = Math.max(0, fromSeq - firstEntry.seq + 1);
      return start < entries.length ? entries.slice(start) : [];
    },
    markPersisted(nextPersistedSeq) {
      persistedSeq = Math.max(
        persistedSeq,
        Math.min(latestSeq, normalizeSeq(nextPersistedSeq)),
      );
    },
    trimPersistedOlderThan(cutoffMs, pinnedBaselineSeq = null) {
      const normalizedCutoffMs = Number.isFinite(cutoffMs)
        ? Number(cutoffMs)
        : Number.POSITIVE_INFINITY;
      const protectedBaselineSeq =
        pinnedBaselineSeq === null ? null : normalizeSeq(pinnedBaselineSeq);
      let keepFrom = entries.length;
      for (const [index, entry] of entries.entries()) {
        if (
          (protectedBaselineSeq !== null && entry.seq > protectedBaselineSeq) ||
          entry.seq > persistedSeq ||
          entry.acceptedAtMs >= normalizedCutoffMs
        ) {
          keepFrom = index;
          break;
        }
      }
      // Replay history must stay a contiguous suffix; trimming only drops a prefix.
      entries = entries.slice(keepFrom);
    },
    trimBefore(seqInclusiveFloor) {
      const floorSeq = normalizeSeq(seqInclusiveFloor);
      const firstEntry = entries[0];
      if (firstEntry) {
        const keepFrom = Math.max(0, floorSeq - firstEntry.seq);
        entries = entries.slice(keepFrom);
      }
      if (entries.length === 0 && persistedSeq > latestSeq) {
        persistedSeq = latestSeq;
      }
    },
  };
}

export { createMutationLog };
