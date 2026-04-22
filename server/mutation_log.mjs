/**
 * @typedef {{
 *   board: string,
 *   acceptedAtMs: number,
 *   mutation: {[key: string]: unknown},
 *   clientMutationId?: string,
 *   socketId?: string,
 *   seq: number,
 * }} MutationEnvelope
 */

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
 *   append: (envelope: Omit<MutationEnvelope, "seq">) => MutationEnvelope,
 *   readRange: (fromExclusiveSeq: number, toInclusiveSeq: number) => MutationEnvelope[],
 *   markPersisted: (persistedSeq: number) => void,
 *   trimPersistedOlderThan: (cutoffMs: number, pinnedBaselineSeq?: number | null) => void,
 *   trimBefore: (seqInclusiveFloor: number) => void,
 * }}
 */
function createMutationLog(initialSeq = 0) {
  let latestSeq = normalizeSeq(initialSeq);
  let persistedSeq = latestSeq;
  /** @type {MutationEnvelope[]} */
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
    append(envelope) {
      const nextEntry = {
        ...envelope,
        seq: latestSeq + 1,
      };
      entries.push(nextEntry);
      latestSeq = nextEntry.seq;
      return nextEntry;
    },
    readRange(fromExclusiveSeq, toInclusiveSeq) {
      const fromSeq = normalizeSeq(fromExclusiveSeq);
      const toSeq = normalizeSeq(toInclusiveSeq);
      return entries.filter(
        (entry) => entry.seq > fromSeq && entry.seq <= toSeq,
      );
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
      entries = entries.filter(
        (entry) =>
          (protectedBaselineSeq !== null && entry.seq > protectedBaselineSeq) ||
          entry.seq > persistedSeq ||
          entry.acceptedAtMs >= normalizedCutoffMs,
      );
    },
    trimBefore(seqInclusiveFloor) {
      const floorSeq = normalizeSeq(seqInclusiveFloor);
      entries = entries.filter((entry) => entry.seq >= floorSeq);
      if (entries.length === 0 && persistedSeq > latestSeq) {
        persistedSeq = latestSeq;
      }
    },
  };
}

export { createMutationLog };
