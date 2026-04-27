import { MutationType } from "../../client-data/js/message_tool_metadata.js";
import observability from "../observability/index.mjs";
import { canAccessBoard, normalizeBoardName } from "./policy.mjs";
import { getSocketQueryValue } from "./request.mjs";
import { readStoredSvgSeq } from "../persistence/svg_board_store.mjs";

const { logger, metrics, tracing } = observability;
const BASELINE_NOT_REPLAYABLE = "baseline_not_replayable";

/** @import { AppSocket, MutationLogEntry, NormalizedMessageData, ServerConfig } from "../../types/server-runtime.d.ts" */
/** @import { BoardData } from "../board/data.mjs" */
/** @typedef {"replayed" | "empty" | "baseline_not_replayable" | "future_baseline" | "error"} ConnectionReplayOutcome */
/** @typedef {{type: number, fromSeq: number, seq: number, _children: NormalizedMessageData[]}} ConnectionReplayBatch */
/** @typedef {{ok: true, boardName: string, board: BoardData, baselineSeq: number, latestSeq: number, minReplayableSeq: number, replayBatch: ConnectionReplayBatch, outcome: "empty" | "replayed"} | {ok: false, reason: string, boardName?: string, baselineSeq?: number, latestSeq?: number, minReplayableSeq?: number, error?: unknown}} ConnectionReplayBootstrap */
/** @typedef {ConnectionReplayBootstrap & {ok: false}} ConnectionReplayFailure */
/** @typedef {Error & {data?: {reason: string, latestSeq?: number, minReplayableSeq?: number}}} ConnectionReplayError */
/** @typedef {(name: string, config: ServerConfig) => Promise<BoardData>} GetBoard */
/** @typedef {(board: BoardData, details?: {baselineSeq?: number, logEvent?: string, persistedFileSeq?: number, reason?: string}) => Promise<boolean>} DropLoadedBoardInstance */
/** @typedef {(board: BoardData, extras?: {[key: string]: unknown}) => {[key: string]: unknown}} BoardDebugFields */

/**
 * @param {string} eventName
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function socketTraceAttributes(eventName, extras) {
  return {
    "wbo.socket.event": eventName,
    ...extras,
  };
}

/**
 * @param {AppSocket} socket
 * @param {ServerConfig} config
 * @returns {{ok: true, boardName: string} | {ok: false, reason: string}}
 */
function bindSocketBoard(socket, config) {
  const rawBoardName =
    typeof socket.boardName === "string"
      ? socket.boardName
      : socket.handshake.query?.board;
  if (typeof rawBoardName !== "string" || rawBoardName === "") {
    return { ok: false, reason: "missing_board_name" };
  }

  const boardName = normalizeBoardName(rawBoardName);
  if (boardName === null) {
    return { ok: false, reason: "invalid_board_name" };
  }
  if (!canAccessBoard(config, boardName, socket)) {
    return { ok: false, reason: "access_forbidden" };
  }

  socket.boardName = boardName;
  return { ok: true, boardName };
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
 * @param {number} baselineSeq
 * @param {number} latestSeq
 * @param {MutationLogEntry[]} replayEntries
 * @returns {ConnectionReplayBatch}
 */
function buildConnectionReplayBatch(baselineSeq, latestSeq, replayEntries) {
  return {
    type: MutationType.BATCH,
    fromSeq: baselineSeq,
    seq: latestSeq,
    _children: replayEntries.map((entry) => entry.mutation),
  };
}

/**
 * @param {ConnectionReplayFailure} replay
 * @returns {ConnectionReplayError}
 */
function createConnectionReplayError(replay) {
  const error = /** @type {ConnectionReplayError} */ (
    new Error(replay.reason || BASELINE_NOT_REPLAYABLE)
  );
  error.data = {
    reason: replay.reason || BASELINE_NOT_REPLAYABLE,
    latestSeq: replay.latestSeq,
    minReplayableSeq: replay.minReplayableSeq,
  };
  return error;
}

/**
 * @param {AppSocket} socket
 * @param {ServerConfig} config
 * @param {GetBoard} getBoard
 * @param {DropLoadedBoardInstance} dropLoadedBoardInstance
 * @param {BoardDebugFields} boardDebugFields
 * @returns {Promise<ConnectionReplayBootstrap>}
 */
async function prepareConnectionReplay(
  socket,
  config,
  getBoard,
  dropLoadedBoardInstance,
  boardDebugFields,
) {
  const bound = bindSocketBoard(socket, config);
  if (bound.ok === false) {
    return { ok: false, reason: bound.reason };
  }

  const boardName = bound.boardName;
  return tracing.withActiveSpan(
    "socket.connection_replay",
    {
      kind: tracing.SpanKind.INTERNAL,
      attributes: socketTraceAttributes("connection_replay", {
        "wbo.board": boardName,
      }),
    },
    async function traceConnectionReplay(span) {
      const baselineSeq = normalizeSeq(
        getSocketQueryValue(socket, "baselineSeq"),
      );
      /** @type {ConnectionReplayOutcome} */
      let outcome = "error";
      /** @type {number | undefined} */
      let latestSeq;
      /** @type {number | undefined} */
      let minReplayableSeq;
      /** @type {number | undefined} */
      let replayCount;
      /** @type {number | undefined} */
      let persistedFileSeq;
      try {
        let board = await getBoard(boardName, config);
        latestSeq = board.getSeq();
        minReplayableSeq = board.minReplayableSeq();
        if (baselineSeq > latestSeq) {
          persistedFileSeq = await readStoredSvgSeq(boardName, {
            historyDir: config.HISTORY_DIR,
          });
          if (persistedFileSeq > latestSeq) {
            await dropLoadedBoardInstance(board, {
              baselineSeq,
              logEvent: "board.stale_instance_dropped_after_future_baseline",
              persistedFileSeq,
              reason: "future_baseline_disk_seq_ahead",
            });
            board = await getBoard(boardName, config);
            latestSeq = board.getSeq();
            minReplayableSeq = board.minReplayableSeq();
          }
        }
        if (baselineSeq > latestSeq || baselineSeq < minReplayableSeq) {
          outcome =
            baselineSeq > latestSeq
              ? "future_baseline"
              : BASELINE_NOT_REPLAYABLE;
          logger.warn(
            "socket.connection_replay_rejected",
            boardDebugFields(board, {
              socket: socket.id,
              "wbo.socket.baseline_seq": baselineSeq,
              "wbo.socket.latest_seq": latestSeq,
              "wbo.socket.min_replayable_seq": minReplayableSeq,
              "wbo.board.persisted_file_seq": persistedFileSeq,
              reason: BASELINE_NOT_REPLAYABLE,
            }),
          );
          return {
            ok: false,
            reason: BASELINE_NOT_REPLAYABLE,
            boardName,
            baselineSeq,
            latestSeq,
            minReplayableSeq,
          };
        }

        const replayEntries = board.readMutationsAfter(baselineSeq);
        const replayBatch = buildConnectionReplayBatch(
          baselineSeq,
          latestSeq,
          replayEntries,
        );
        replayCount = replayBatch._children.length;
        outcome = replayCount > 0 ? "replayed" : "empty";
        return {
          ok: true,
          boardName,
          board,
          baselineSeq,
          latestSeq,
          minReplayableSeq,
          replayBatch,
          outcome,
        };
      } catch (error) {
        return {
          ok: false,
          reason: "error",
          boardName,
          baselineSeq,
          latestSeq,
          minReplayableSeq,
          error,
        };
      } finally {
        if (span) {
          tracing.setSpanAttributes(span, {
            "wbo.socket.connection_replay.outcome": outcome,
            "wbo.socket.baseline_seq": baselineSeq,
            "wbo.socket.latest_seq": latestSeq,
            "wbo.socket.min_replayable_seq": minReplayableSeq,
            "wbo.socket.replay.count": replayCount,
            "wbo.board.persisted_file_seq": persistedFileSeq,
          });
        }
        metrics.recordSocketConnectionReplay({
          board: boardName,
          outcome,
          baselineSeq,
          latestSeq,
          persistedFileSeq,
        });
      }
    },
  );
}

export { createConnectionReplayError, prepareConnectionReplay };
