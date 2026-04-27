import { stat } from "node:fs/promises";
import { rebuildLiveItemCount } from "./board_canonical_index.mjs";
import { getMinPinnedReplayBaselineSeq } from "./board_registry.mjs";
import { finalizePersistedCanonicalItems } from "./board_canonical_index.mjs";
import { boardJsonPath } from "./legacy_json_board_source.mjs";
import { createMutationLog } from "./mutation_log.mjs";
import observability from "./observability.mjs";
import { SerialTaskQueue } from "./serial_task_queue.mjs";
import { boardSvgBackupPath } from "./svg_board_paths.mjs";
import {
  readCanonicalBoardState,
  rewriteStoredSvgFromCanonical,
  writeCanonicalBoardState,
} from "./svg_board_store.mjs";

const { logger, metrics, tracing } = observability;

const STANDALONE_BOARD_LOAD_BYTES_THRESHOLD = 1024 * 1024;
const STANDALONE_BOARD_SAVE_ITEM_COUNT_THRESHOLD = 2048;
const boardSaveQueue = new SerialTaskQueue();

/** @import { BoardData } from "./boardData.mjs" */
/** @typedef {{actualFileSeq?: number, durationMs?: number, saveTargetSeq?: number}} StaleSaveDetails */
/** @typedef {{status: "saved" | "skipped" | "stale" | "failed"}} BoardSaveResult */
/**
 * @typedef {new (
 *   name: string,
 *   config: import("./boardData.mjs").BoardConfig
 * ) => BoardData} BoardDataConstructor
 */

/**
 * @param {string} boardName
 * @param {string} operation
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function boardTraceAttributes(boardName, operation, extras) {
  return {
    "wbo.board": boardName,
    "wbo.board.operation": operation,
    ...extras,
  };
}

/**
 * @param {BoardData} board
 * @returns {number}
 */
function countDirtyItems(board) {
  let count = 0;
  for (const item of board.itemsById.values()) {
    if (item?.dirty === true) count += 1;
  }
  return count;
}

/**
 * @param {BoardData} board
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function boardLogFields(board, extras) {
  return {
    board: board.name,
    "wbo.board.instance": board.instanceId,
    "wbo.board.seq": board.getSeq(),
    "wbo.board.persisted_seq": board.getPersistedSeq(),
    "wbo.board.min_replayable_seq": board.minReplayableSeq(),
    "wbo.board.has_persisted_baseline": board.hasPersistedBaseline,
    "wbo.board.items": board.authoritativeItemCount(),
    "wbo.board.dirty_items": countDirtyItems(board),
    "wbo.board.users": board.users.size,
    ...(extras || {}),
  };
}

/**
 * @param {{
 *   nowMs: number,
 *   dirtyFromMs: number | null,
 *   lastWriteAtMs: number | null,
 *   saveIntervalMs: number,
 *   maxSaveDelayMs: number,
 * }} options
 * @returns {number}
 */
function computeScheduledSaveDelayMs(options) {
  if (options.dirtyFromMs === null || options.lastWriteAtMs === null) {
    return 0;
  }
  const idleDeadlineMs =
    options.lastWriteAtMs + Math.max(0, Number(options.saveIntervalMs) || 0);
  const maxDelayDeadlineMs =
    options.dirtyFromMs + Math.max(0, Number(options.maxSaveDelayMs) || 0);
  return Math.max(
    0,
    Math.min(idleDeadlineMs, maxDelayDeadlineMs) - options.nowMs,
  );
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorCode(error) {
  if (!error || typeof error !== "object") return undefined;
  if (!("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/**
 * @param {BoardData} board
 * @returns {void}
 */
function clearSaveTimeout(board) {
  if (board.saveTimeoutId === undefined) return;
  clearTimeout(board.saveTimeoutId);
  board.saveTimeoutId = undefined;
}

/**
 * @param {BoardData} board
 * @param {number} [nowMs]
 * @returns {number | null}
 */
function dirtyAgeMs(board, nowMs = Date.now()) {
  return board.dirtyFromMs === null
    ? null
    : Math.max(0, nowMs - board.dirtyFromMs);
}

/**
 * @param {BoardData} board
 * @returns {void}
 */
function delaySave(board) {
  const nowMs = Date.now();
  if (board.dirtyFromMs === null) {
    board.dirtyFromMs = nowMs;
  }
  if (board.saveInProgress && board.dirtyDuringSaveFromMs === null) {
    board.dirtyDuringSaveFromMs = nowMs;
  }
  board.lastWriteAtMs = nowMs;
  if (board.saveInProgress) return;
  scheduleDirtySave(board, nowMs);
}

/**
 * @param {BoardData} board
 * @param {number} [nowMs]
 * @returns {void}
 */
function scheduleDirtySave(board, nowMs = Date.now()) {
  const delayMs = computeScheduledSaveDelayMs({
    nowMs,
    dirtyFromMs: board.dirtyFromMs,
    lastWriteAtMs: board.lastWriteAtMs,
    saveIntervalMs: board.config.SAVE_INTERVAL,
    maxSaveDelayMs: board.config.MAX_SAVE_DELAY,
  });
  if (logger.isEnabled("debug")) {
    logger.debug(
      "board.save_scheduled",
      boardLogFields(board, {
        "wbo.board.delay_ms": delayMs,
        "wbo.board.max_save_delay_ms": board.config.MAX_SAVE_DELAY,
      }),
    );
  }
  scheduleSaveTimeout(board, delayMs);
}

/**
 * @param {BoardData} board
 * @param {number} delayMs
 * @returns {void}
 */
function scheduleSaveTimeout(board, delayMs) {
  if (
    board.disposed ||
    board.saveInProgress ||
    board.dirtyFromMs === null ||
    board.lastWriteAtMs === null
  ) {
    clearSaveTimeout(board);
    return;
  }
  clearSaveTimeout(board);
  if (logger.isEnabled("debug")) {
    logger.debug(
      "board.save_timer_set",
      boardLogFields(board, {
        "wbo.board.delay_ms": Math.max(0, delayMs),
      }),
    );
  }
  board.saveTimeoutId = setTimeout(
    () => {
      board.saveTimeoutId = undefined;
      if (board.disposed) return;
      if (logger.isEnabled("debug")) {
        logger.debug("board.save_timer_fired", boardLogFields(board));
      }
      if (board.saveInProgress) {
        return;
      }
      void board.save();
    },
    Math.max(0, delayMs),
  );
}

/**
 * @param {BoardData} board
 * @returns {void}
 */
function disposeBoard(board) {
  if (logger.isEnabled("debug")) {
    logger.debug("board.disposed", boardLogFields(board));
  }
  board.disposed = true;
  clearSaveTimeout(board);
}

/**
 * @param {BoardData} board
 * @returns {boolean}
 */
function hasDirtyItems(board) {
  for (const item of board.itemsById.values()) {
    if (item.dirty === true) return true;
  }
  return false;
}

/**
 * @param {BoardData} board
 * @param {Map<string, any>} [persistedSnapshot]
 * @param {Set<string>} [persistedIds]
 * @returns {void}
 */
function finalizePersistedItems(
  board,
  persistedSnapshot = board.itemsById,
  persistedIds = new Set(persistedSnapshot.keys()),
) {
  finalizePersistedCanonicalItems(board, persistedSnapshot, persistedIds);
}

/**
 * @param {BoardData} board
 * @param {number} [nowMs]
 * @returns {void}
 */
function trimPersistedMutationLog(board, nowMs = Date.now()) {
  const retentionMs = Math.max(0, board.config.SEQ_REPLAY_RETENTION_MS);
  const pinnedBaselineSeq = getMinPinnedReplayBaselineSeq(board.name, nowMs);
  board.mutationLog.trimPersistedOlderThan(
    nowMs - retentionMs,
    pinnedBaselineSeq,
  );
}

/**
 * @param {BoardData} board
 * @returns {Promise<BoardSaveResult>}
 */
async function saveBoard(board) {
  if (board.disposed) return { status: "skipped" };
  // Persisted board writes are serialized process-wide so only one board save
  // mutates on-disk state at a time.
  return boardSaveQueue.runExclusive(board._unsafe_save.bind(board));
}

/**
 * @param {BoardData} board
 * @returns {Promise<BoardSaveResult>}
 */
async function unsafeSaveBoard(board) {
  return tracing.withExpensiveActiveSpan(
    "board.save",
    {
      attributes: boardTraceAttributes(board.name, "save"),
      traceRoot:
        board.itemsById.size >= STANDALONE_BOARD_SAVE_ITEM_COUNT_THRESHOLD,
    },
    async () => {
      let shouldScheduleAfterSave = false;
      clearSaveTimeout(board);
      board.saveInProgress = true;
      board.dirtyDuringSaveFromMs = null;
      try {
        if (board.disposed) return { status: "skipped" };
        if (
          hasDirtyItems(board) !== true &&
          board.getSeq() === board.getPersistedSeq()
        ) {
          if (logger.isEnabled("debug")) {
            logger.debug("board.save_skipped", boardLogFields(board));
          }
          return { status: "skipped" };
        }
        const startedAt = Date.now();
        board.saveStartedAtMs = startedAt;
        board.saveTargetSeq = board.getSeq();
        if (logger.isEnabled("debug")) {
          logger.debug(
            "board.save_started",
            boardLogFields(board, {
              "wbo.board.save_target_seq": board.saveTargetSeq,
            }),
          );
        }
        board.clean();
        const savedItemsById = new Map(board.itemsById);
        const savedPaintOrder = [...board.paintOrder];
        const file = board.file;
        const authoritativeItemCount = savedPaintOrder.filter(
          (id) => savedItemsById.get(id)?.deleted !== true,
        ).length;
        const saveTargetSeq = board.saveTargetSeq ?? board.getSeq();
        const saveStrategy =
          board.persistedItemIds.size > 0 ? "rewrite" : "write";
        try {
          const persistedIds = await tracing.withRecordingActiveSpan(
            "board.save_write",
            {
              attributes: boardTraceAttributes(board.name, "save_write", {
                "wbo.board.items": authoritativeItemCount,
                "wbo.board.save_strategy": saveStrategy,
                "wbo.board.save_target_seq": saveTargetSeq,
              }),
            },
            async (span) => {
              const ids =
                saveStrategy === "rewrite"
                  ? await rewriteStoredSvgFromCanonical(
                      board.name,
                      savedItemsById,
                      savedPaintOrder,
                      board.metadata,
                      board.persistedItemIds,
                      board.getPersistedSeq(),
                      saveTargetSeq,
                      { historyDir: board.historyDir },
                    )
                  : (
                      await writeCanonicalBoardState(
                        board.name,
                        savedItemsById,
                        savedPaintOrder,
                        board.metadata,
                        saveTargetSeq,
                        { historyDir: board.historyDir },
                      )
                    ).persistedIds;
              if (span) {
                tracing.setSpanAttributes(
                  span,
                  boardTraceAttributes(board.name, "save_write", {
                    "wbo.board.result": "success",
                    "wbo.board.items": authoritativeItemCount,
                    "wbo.board.persisted_items": ids.size,
                    "wbo.board.save_strategy": saveStrategy,
                    "wbo.board.save_target_seq": saveTargetSeq,
                  }),
                );
              }
              return ids;
            },
          );
          board.persistedItemIds = new Set(persistedIds);
          board.markPersistedSeq(saveTargetSeq);
          finalizePersistedItems(board, savedItemsById, persistedIds);
          const savedAllSnapshotLiveItems =
            authoritativeItemCount === persistedIds.size;
          if (hasDirtyItems(board) !== true) {
            board.dirtyFromMs = null;
            board.lastWriteAtMs = null;
          } else if (
            savedAllSnapshotLiveItems &&
            board.dirtyDuringSaveFromMs !== null
          ) {
            board.dirtyFromMs = board.dirtyDuringSaveFromMs;
          }
          board.trimPersistedMutationLog(startedAt);
          const savedFile = await stat(file).catch(async (error) => {
            if (errorCode(error) !== "ENOENT") {
              throw error;
            }
            return stat(boardSvgBackupPath(board.name, board.historyDir)).catch(
              () => null,
            );
          });
          const durationMs = Date.now() - startedAt;
          tracing.setActiveSpanAttributes(
            boardTraceAttributes(board.name, "save", {
              "wbo.board.result": "success",
              ...(savedFile
                ? {
                    "file.size": savedFile.size,
                  }
                : {}),
              "wbo.board.items": authoritativeItemCount,
              "wbo.board.persisted_items": persistedIds.size,
            }),
          );
          logger.info(
            "board.saved",
            boardLogFields(board, {
              duration_ms: durationMs,
              ...(savedFile ? { "file.size": savedFile.size } : {}),
            }),
          );
          metrics.recordBoardOperationDuration(
            "save",
            board.name,
            durationMs / 1000,
          );
          if (board.getSeq() !== saveTargetSeq) {
            shouldScheduleAfterSave = true;
          }
          return { status: "saved" };
        } catch (err) {
          const durationMs = Date.now() - startedAt;
          const code = errorCode(err);
          if (
            board.persistedItemIds.size > 0 &&
            (code === "ENOENT" || code === "WBO_STORED_SVG_SEQ_MISMATCH")
          ) {
            const actualFileSeq =
              err &&
              typeof err === "object" &&
              "actualSeq" in err &&
              typeof err.actualSeq === "number"
                ? err.actualSeq
                : undefined;
            const staleFields = boardLogFields(board, {
              duration_ms: durationMs,
              "wbo.board.save_target_seq": saveTargetSeq,
              "wbo.board.actual_file_seq": actualFileSeq,
              "wbo.board.dropped_local_seq_count": Math.max(
                0,
                board.getSeq() - board.getPersistedSeq(),
              ),
              "wbo.board.dirty_age_ms": dirtyAgeMs(board),
              "wbo.board.stale_reason":
                code === "WBO_STORED_SVG_SEQ_MISMATCH"
                  ? "seq_mismatch"
                  : "missing_baseline",
            });
            tracing.setActiveSpanAttributes(
              boardTraceAttributes(board.name, "save", {
                "wbo.board.result": "stale",
                "wbo.board.save_target_seq": saveTargetSeq,
                ...(actualFileSeq === undefined
                  ? {}
                  : { "wbo.board.actual_file_seq": actualFileSeq }),
                "wbo.board.dropped_local_seq_count": Math.max(
                  0,
                  board.getSeq() - board.getPersistedSeq(),
                ),
              }),
            );
            logger.warn("board.save_stale", staleFields);
            metrics.recordBoardOperationDuration(
              "save",
              board.name,
              durationMs / 1000,
              "stale",
            );
            if (typeof board.onStaleSave === "function") {
              try {
                await board.onStaleSave({
                  actualFileSeq,
                  durationMs,
                  saveTargetSeq,
                });
              } catch (handlerError) {
                logger.error("board.stale_save_handler_failed", {
                  board: board.name,
                  error: handlerError,
                });
              }
            }
            return { status: "stale" };
          }
          tracing.recordActiveSpanError(err, {
            "wbo.board.result": "error",
          });
          logger.error(
            "board.save_failed",
            boardLogFields(board, {
              duration_ms: durationMs,
              error: err,
            }),
          );
          metrics.recordBoardOperationDuration(
            "save",
            board.name,
            durationMs / 1000,
            err,
          );
          if (
            !board.disposed &&
            (hasDirtyItems(board) === true ||
              board.getSeq() !== board.getPersistedSeq())
          ) {
            shouldScheduleAfterSave = true;
          }
          return { status: "failed" };
        }
      } finally {
        board.saveInProgress = false;
        board.dirtyDuringSaveFromMs = null;
        board.saveStartedAtMs = null;
        board.saveTargetSeq = null;
        if (
          shouldScheduleAfterSave &&
          !board.disposed &&
          (hasDirtyItems(board) === true ||
            board.getSeq() !== board.getPersistedSeq())
        ) {
          scheduleDirtySave(board, Date.now());
        }
      }
    },
  );
}

/**
 * @param {BoardDataConstructor} BoardDataClass
 * @param {string} name
 * @param {import("./boardData.mjs").BoardConfig} config
 * @returns {Promise<BoardData>}
 */
async function loadBoardData(BoardDataClass, name, config) {
  const boardData = new BoardDataClass(name, config);
  let traceRoot = false;
  for (const candidateFile of [
    boardData.file,
    boardJsonPath(name, boardData.historyDir),
  ]) {
    try {
      const candidate = await stat(candidateFile);
      traceRoot = candidate.size >= STANDALONE_BOARD_LOAD_BYTES_THRESHOLD;
      if (traceRoot) break;
    } catch {}
  }
  return tracing.withExpensiveActiveSpan(
    "board.load",
    {
      attributes: boardTraceAttributes(name, "load"),
      traceRoot: traceRoot,
    },
    async function loadBoardDataWithTracing() {
      const startedAt = Date.now();
      try {
        if (logger.isEnabled("debug")) {
          logger.debug("board.load_started", boardLogFields(boardData));
        }
        /**
         * @param {import("@opentelemetry/api").Span | undefined} span
         */
        const readStoredBoard = async (span) => {
          const state = await readCanonicalBoardState(name, {
            historyDir: boardData.historyDir,
          });
          if (span) {
            tracing.setSpanAttributes(
              span,
              boardTraceAttributes(name, "load_read", {
                "wbo.board.result": "success",
                "wbo.board.load_source": state.source,
                "wbo.board.items": state.itemsById.size,
                "wbo.board.seq": state.seq,
                "file.size": state.byteLength || 0,
              }),
            );
          }
          return state;
        };
        const storedBoard = await tracing.withRecordingActiveSpan(
          "board.load_read",
          {
            attributes: boardTraceAttributes(name, "load_read"),
          },
          readStoredBoard,
        );
        boardData.itemsById = storedBoard.itemsById;
        boardData.paintOrder = storedBoard.paintOrder;
        boardData.nextPaintOrder = storedBoard.paintOrder.reduce(
          /**
           * @param {number} max
           * @param {string} id
           */
          (max, id) => {
            const item = storedBoard.itemsById.get(id);
            return item ? Math.max(max, item.paintOrder + 1) : max;
          },
          0,
        );
        rebuildLiveItemCount(boardData);
        boardData.trimPaintOrderIndex = 0;
        boardData.persistedItemIds = new Set(storedBoard.itemsById.keys());
        boardData.dirtyFromMs = null;
        boardData.lastWriteAtMs = null;
        boardData.dirtyDuringSaveFromMs = null;
        boardData.saveStartedAtMs = null;
        boardData.saveTargetSeq = null;
        boardData.loadSource = storedBoard.source;
        boardData.metadata = storedBoard.metadata;
        boardData.mutationLog = createMutationLog(storedBoard.seq);
        if (logger.isEnabled("debug")) {
          logger.debug(
            "board.load_completed",
            boardLogFields(boardData, {
              "wbo.board.load_source": storedBoard.source,
              "file.size": storedBoard.byteLength || 0,
            }),
          );
        }
        const durationMs = Date.now() - startedAt;
        logger.info(
          "board.loaded",
          boardLogFields(boardData, {
            duration_ms: durationMs,
            "wbo.board.load_source": storedBoard.source,
            "wbo.board.paint_order_entries": boardData.paintOrder.length,
            "file.size": storedBoard.byteLength || 0,
            items: boardData.authoritativeItemCount(),
          }),
        );
        tracing.setActiveSpanAttributes(
          boardTraceAttributes(name, "load", {
            "wbo.board.result": "success",
            "file.size": storedBoard.byteLength || 0,
            "wbo.board.items": boardData.authoritativeItemCount(),
          }),
        );
        metrics.recordBoardOperationDuration("load", name, durationMs / 1000);
      } catch (e) {
        // If the file doesn't exist, this is not an error
        if (errorCode(e) === "ENOENT") {
          if (logger.isEnabled("debug")) {
            logger.debug(
              "board.load_empty",
              boardLogFields(boardData, {
                "wbo.board.load_source": "empty",
              }),
            );
          }
          const durationMs = Date.now() - startedAt;
          logger.info(
            "board.loaded",
            boardLogFields(boardData, {
              duration_ms: durationMs,
              "wbo.board.load_source": "empty",
              "wbo.board.result": "empty",
              items: 0,
            }),
          );
          tracing.setActiveSpanAttributes(
            boardTraceAttributes(name, "load", {
              "wbo.board.result": "empty",
            }),
          );
          metrics.recordBoardOperationDuration(
            "load",
            name,
            durationMs / 1000,
            "empty",
          );
        } else {
          const durationMs = Date.now() - startedAt;
          tracing.recordActiveSpanError(e, {
            "wbo.board.result": "error",
          });
          logger.error(
            "board.load_failed",
            boardLogFields(boardData, {
              duration_ms: durationMs,
              error: e,
            }),
          );
          metrics.recordBoardOperationDuration(
            "load",
            name,
            durationMs / 1000,
            e,
          );
        }
        boardData.itemsById = new Map();
        boardData.paintOrder = [];
        boardData.nextPaintOrder = 0;
        boardData.persistedItemIds = new Set();
        boardData.dirtyFromMs = null;
        boardData.lastWriteAtMs = null;
        boardData.dirtyDuringSaveFromMs = null;
        boardData.saveStartedAtMs = null;
        boardData.saveTargetSeq = null;
        boardData.liveItemCount = 0;
        boardData.trimPaintOrderIndex = 0;
      }
      return boardData;
    },
  );
}

export {
  clearSaveTimeout,
  computeScheduledSaveDelayMs,
  delaySave,
  dirtyAgeMs,
  disposeBoard,
  finalizePersistedItems,
  hasDirtyItems,
  loadBoardData,
  saveBoard,
  scheduleDirtySave,
  scheduleSaveTimeout,
  trimPersistedMutationLog,
  unsafeSaveBoard,
};
