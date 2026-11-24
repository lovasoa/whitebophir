/** @typedef {Promise<import("./data.mjs").BoardData>} BoardPromise */

/** @type {Map<string, BoardPromise>} */
const loadedBoards = new Map();

/** @type {Map<string, Map<number, number>>} */
const replayPinsByBoard = new Map();

/**
 * @param {string} boardName
 * @returns {BoardPromise | undefined}
 */
function getLoadedBoard(boardName) {
  return loadedBoards.get(boardName);
}

/**
 * @param {string} boardName
 * @param {BoardPromise} board
 * @returns {void}
 */
function setLoadedBoard(boardName, board) {
  loadedBoards.set(boardName, board);
}

/**
 * @param {string} boardName
 * @returns {void}
 */
function deleteLoadedBoard(boardName) {
  loadedBoards.delete(boardName);
}

/**
 * @returns {string[]}
 */
function listLoadedBoards() {
  return Array.from(loadedBoards.keys());
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeSeq(value) {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : 0;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeExpiry(value) {
  const expiresAtMs = Number(value);
  return Number.isFinite(expiresAtMs) ? expiresAtMs : null;
}

/**
 * @param {string} boardName
 * @returns {Map<number, number>}
 */
function ensureReplayPins(boardName) {
  const existing = replayPinsByBoard.get(boardName);
  if (existing) return existing;
  const created = new Map();
  replayPinsByBoard.set(boardName, created);
  return created;
}

/**
 * @param {string} boardName
 * @param {number} nowMs
 * @returns {Map<number, number> | null}
 */
function pruneReplayPins(boardName, nowMs) {
  const pins = replayPinsByBoard.get(boardName);
  if (!pins) return null;
  for (const [seq, expiresAtMs] of pins) {
    if (expiresAtMs <= nowMs) pins.delete(seq);
  }
  if (pins.size === 0) {
    replayPinsByBoard.delete(boardName);
    return null;
  }
  return pins;
}

/** Sweep at most this often, so board pages do not pay a full scan each time. */
const REPLAY_PIN_SWEEP_INTERVAL_MS = 60 * 1000;

/** @type {number} */
let lastReplayPinSweepMs = 0;

/**
 * Removes expired pins for every board. HTTP-only views (crawlers, previews)
 * never come back to their board, so pruning just the requested board lets one
 * dead entry per served board name live until the process restarts.
 * @param {number} [nowMs]
 * @returns {number} boards removed
 */
function pruneExpiredReplayPins(nowMs = Date.now()) {
  let removed = 0;
  for (const [boardName, pins] of replayPinsByBoard) {
    for (const [seq, expiresAtMs] of pins) {
      if (expiresAtMs <= nowMs) pins.delete(seq);
    }
    if (pins.size === 0) {
      replayPinsByBoard.delete(boardName);
      removed += 1;
    }
  }
  return removed;
}

/**
 * @param {number} nowMs
 * @returns {void}
 */
function sweepExpiredReplayPins(nowMs) {
  if (nowMs - lastReplayPinSweepMs < REPLAY_PIN_SWEEP_INTERVAL_MS) return;
  lastReplayPinSweepMs = nowMs;
  pruneExpiredReplayPins(nowMs);
}

/**
 * @param {string} boardName
 * @param {number} baselineSeq
 * @param {number} expiresAtMs
 * @returns {void}
 */
function pinReplayBaseline(boardName, baselineSeq, expiresAtMs) {
  const normalizedSeq = normalizeSeq(baselineSeq);
  const normalizedExpiry = normalizeExpiry(expiresAtMs);
  if (normalizedExpiry === null) return;
  sweepExpiredReplayPins(Date.now());
  const pins = ensureReplayPins(boardName);
  const currentExpiry = pins.get(normalizedSeq) || 0;
  if (normalizedExpiry > currentExpiry) {
    pins.set(normalizedSeq, normalizedExpiry);
  }
}

/**
 * @param {string} boardName
 * @param {number} [nowMs]
 * @returns {number | null}
 */
function getMinPinnedReplayBaselineSeq(boardName, nowMs = Date.now()) {
  const pins = pruneReplayPins(boardName, nowMs);
  if (!pins) return null;
  let minSeq = null;
  for (const seq of pins.keys()) {
    minSeq = minSeq === null ? seq : Math.min(minSeq, seq);
  }
  return minSeq;
}

/**
 * @param {string} boardName
 * @param {number} [nowMs]
 * @returns {number | null}
 */
function getNextReplayPinExpiry(boardName, nowMs = Date.now()) {
  const pins = pruneReplayPins(boardName, nowMs);
  if (!pins) return null;
  let nextExpiry = null;
  for (const expiresAtMs of pins.values()) {
    nextExpiry =
      nextExpiry === null ? expiresAtMs : Math.min(nextExpiry, expiresAtMs);
  }
  return nextExpiry;
}

/**
 * After unload, only the current persisted baseline remains replayable from disk.
 *
 * @param {string} boardName
 * @param {number} persistedSeq
 * @param {number} [nowMs]
 * @returns {void}
 */
function discardPinnedReplayBaselinesBefore(
  boardName,
  persistedSeq,
  nowMs = Date.now(),
) {
  const pins = pruneReplayPins(boardName, nowMs);
  if (!pins) return;
  const normalizedPersistedSeq = normalizeSeq(persistedSeq);
  for (const seq of pins.keys()) {
    if (seq < normalizedPersistedSeq) pins.delete(seq);
  }
  if (pins.size === 0) replayPinsByBoard.delete(boardName);
}

/**
 * @returns {void}
 */
function resetBoardRegistry() {
  loadedBoards.clear();
  replayPinsByBoard.clear();
  lastReplayPinSweepMs = 0;
}

export {
  deleteLoadedBoard,
  discardPinnedReplayBaselinesBefore,
  getLoadedBoard,
  getMinPinnedReplayBaselineSeq,
  getNextReplayPinExpiry,
  listLoadedBoards,
  pinReplayBaseline,
  pruneExpiredReplayPins,
  resetBoardRegistry,
  setLoadedBoard,
};
