/** @typedef {Promise<import("./data.mjs").BoardData>} BoardPromise */
/** @typedef {{ expiresAtMs: number, timer: NodeJS.Timeout }} ReplayPin */

/** @type {Map<string, BoardPromise>} */
const loadedBoards = new Map();

/** @type {Map<string, Map<number, ReplayPin>>} */
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
 * @returns {Map<number, ReplayPin>}
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
 * @param {Map<number, ReplayPin>} pins
 * @param {number} seq
 * @param {ReplayPin} pin
 */
function deleteReplayPin(boardName, pins, seq, pin) {
  clearTimeout(pin.timer);
  pins.delete(seq);
  if (pins.size === 0) replayPinsByBoard.delete(boardName);
}

/**
 * @param {string} boardName
 * @param {number} nowMs
 * @returns {Map<number, ReplayPin> | null}
 */
function pruneReplayPins(boardName, nowMs) {
  const pins = replayPinsByBoard.get(boardName);
  if (!pins) return null;
  for (const [seq, pin] of pins) {
    if (pin.expiresAtMs <= nowMs) deleteReplayPin(boardName, pins, seq, pin);
  }
  return pins.size > 0 ? pins : null;
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
  if (normalizedExpiry === null || normalizedExpiry <= 0) return;
  const pins = ensureReplayPins(boardName);
  const current = pins.get(normalizedSeq);
  if (current) {
    current.expiresAtMs = Math.max(current.expiresAtMs, normalizedExpiry);
    return;
  }

  /**
   * @param {number} deadlineMs
   * @returns {NodeJS.Timeout}
   */
  function scheduleExpiry(deadlineMs) {
    // Node treats timeout delays above the signed 32-bit limit as 1 ms.
    const delay = Math.min(Math.ceil(deadlineMs - Date.now()), 0x7fffffff);
    const timer = setTimeout(() => {
      if (Date.now() < pin.expiresAtMs) {
        // A later view extended this pin, or the deadline has not arrived yet.
        pin.timer = scheduleExpiry(pin.expiresAtMs);
      } else {
        deleteReplayPin(boardName, pins, normalizedSeq, pin);
      }
    }, delay);
    process.unref(timer);
    return timer;
  }

  const pin = {
    expiresAtMs: normalizedExpiry,
    timer: scheduleExpiry(normalizedExpiry),
  };
  pins.set(normalizedSeq, pin);
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
  for (const { expiresAtMs } of pins.values()) {
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
  for (const [seq, pin] of pins) {
    if (seq < normalizedPersistedSeq)
      deleteReplayPin(boardName, pins, seq, pin);
  }
}

/**
 * @returns {void}
 */
function resetBoardRegistry() {
  loadedBoards.clear();
  for (const pins of replayPinsByBoard.values()) {
    for (const pin of pins.values()) clearTimeout(pin.timer);
  }
  replayPinsByBoard.clear();
}

export {
  deleteLoadedBoard,
  discardPinnedReplayBaselinesBefore,
  getLoadedBoard,
  getMinPinnedReplayBaselineSeq,
  getNextReplayPinExpiry,
  listLoadedBoards,
  pinReplayBaseline,
  resetBoardRegistry,
  setLoadedBoard,
};
