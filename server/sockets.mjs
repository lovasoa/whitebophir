import * as socketIO from "socket.io";
import WBOMessageCommon from "../client-data/js/message_common.js";
import {
  formatMessageTypeTag,
  getMutationType,
  getToolId,
  MutationType,
} from "../client-data/js/message_tool_metadata.js";
import { SocketEvents } from "../client-data/js/socket_events.js";
import { Cursor } from "../client-data/tools/index.js";
import {
  deleteLoadedBoard,
  discardPinnedReplayBaselinesBefore,
  getLoadedBoard,
  getMinPinnedReplayBaselineSeq,
  getNextReplayPinExpiry,
  listLoadedBoards,
  resetBoardRegistry,
  setLoadedBoard,
} from "./board_registry.mjs";
import { getBoardSession } from "./board_session.mjs";
import { BoardData } from "./boardData.mjs";
import observability from "./observability.mjs";
import {
  boardUserDebugFields,
  buildBoardUserRecord as createBoardUserRecord,
  buildUserId,
  buildUserName,
  cleanupBoardUserMap,
  clearBoardUsers,
  emitBoardUsersToSocket,
  emitUserJoinedToBoard,
  ensureBoardUser,
  getBoardUserMap,
  removeBoardUser,
  resetBoardUserMaps,
  updateBoardUserFromMessage,
} from "./socket_presence.mjs";
import {
  canAccessBoard,
  canApplyBoardMessage,
  canWriteToBoard,
  getClientIp,
  normalizeBoardName,
  normalizeBroadcastData,
} from "./socket_policy.mjs";
import {
  consumeFixedWindowRateLimit,
  countConstructiveActions,
  countDestructiveActions,
  countTextCreationActions,
  createRateLimitState,
  enforceBroadcastPostNormalization,
  enforceBroadcastPreNormalization,
  pruneRateLimitMap,
  recordCompletedRateLimitWindow,
  resetRateLimitMaps as resetSocketRateLimitMaps,
} from "./socket_rate_limits.mjs";
import {
  getLastUserReportLog as getLastSocketUserReportLog,
  handleReportUserMessage,
  resetSocketReports,
} from "./socket_reports.mjs";
import {
  getSocketQueryValue,
  getSocketRequest,
  getSocketUserSecret,
} from "./socket_request.mjs";
import {
  handleTurnstileTokenMessage,
  isTurnstileValidationActive,
} from "./socket_turnstile.mjs";
import { readStoredSvgSeq } from "./svg_board_store.mjs";

const { Server } = socketIO;
const { logger, metrics, tracing } = observability;

const BASELINE_NOT_REPLAYABLE = "baseline_not_replayable";

/** @typedef {"replayed" | "empty" | "baseline_not_replayable" | "future_baseline" | "error"} ConnectionReplayOutcome */

/** @import { AppSocket, MessageData, MutationLogEntry, NormalizedMessageData, RateLimitState, ReportUserPayload, SequencedMutationBroadcastData, ServerConfig, TurnstileAckCallback } from "../types/server-runtime.d.ts" */
/** @typedef {{board?: string, token?: string, tool?: string, color?: string, size?: string, baselineSeq?: string}} SocketQuery */
/** @typedef {{socketId: string, userId: string, name: string, ip: string, userAgent: string, language: string, color: string, size: number, lastTool: string, lastSeen: number}} BoardUser */
/** @typedef {{type: number, fromSeq: number, seq: number, _children: NormalizedMessageData[]}} ConnectionReplayBatch */
/** @typedef {{ok: true, boardName: string, board: BoardData, baselineSeq: number, latestSeq: number, minReplayableSeq: number, replayBatch: ConnectionReplayBatch, outcome: "empty" | "replayed"} | {ok: false, reason: string, boardName?: string, baselineSeq?: number, latestSeq?: number, minReplayableSeq?: number, error?: unknown}} ConnectionReplayBootstrap */
/** @typedef {ConnectionReplayBootstrap & {ok: false}} ConnectionReplayFailure */
/** @typedef {Error & {data?: {reason: string, latestSeq?: number, minReplayableSeq?: number}}} ConnectionReplayError */
/** @type {Map<string, AppSocket>} */
const activeSockets = new Map();
/** @type {Set<string>} */
const syncedPersistentSockets = new Set();
let connectedUsersTotal = 0;
let invalidIpSourceLogged = false;
/** @type {import("socket.io").Server | undefined} */
let io;
let shuttingDown = false;
/**
 * @param {BoardData} board
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function boardDebugFields(board, extras) {
  return {
    board: board.name,
    "wbo.board.instance": board.instanceId,
    "wbo.board.seq": board.getSeq(),
    "wbo.board.persisted_seq": board.getPersistedSeq(),
    "wbo.board.min_replayable_seq": board.minReplayableSeq(),
    "wbo.board.has_persisted_baseline": board.hasPersistedBaseline,
    "wbo.board.users": board.users.size,
    ...(extras || {}),
  };
}
/**
 * Wraps a socket event handler with standard error logging and metrics.
 * @template {any[]} Args
 * @param {(...args: Args) => unknown} fn
 * @param {string=} eventName
 * @returns {(...args: Args) => Promise<unknown | undefined>}
 */
function wrapSocketEventHandler(fn, eventName) {
  return async function wrappedSocketEventHandler(...args) {
    const startedAt = eventName ? Date.now() : 0;
    /** @type {unknown} */
    let eventErrorType;
    const recordEventMetric = () => {
      if (!eventName) return;
      metrics.recordSocketEvent({
        event: eventName,
        durationMs: Date.now() - startedAt,
        errorType: eventErrorType,
      });
    };
    /**
     * @param {unknown} error
     */
    const logError = (error) => {
      eventErrorType = error;
      logger.error("socket.event_failed", {
        "wbo.socket.event": eventName,
        error: error,
      });
    };
    try {
      return await fn(...args);
    } catch (error) {
      logError(error);
      return undefined;
    } finally {
      recordEventMetric();
    }
  };
}

/**
 * Registers a socket event handler with standard error logging and metrics.
 * @template {any[]} Args
 * @param {AppSocket} socket
 * @param {string} eventName
 * @param {(...args: Args) => unknown} handler
 * @returns {void}
 */
function onSocketEvent(socket, eventName, handler) {
  socket.on(eventName, wrapSocketEventHandler(handler, eventName));
}

function updateLoadedBoardsGauge() {
  metrics.setLoadedBoards(listLoadedBoards().length);
}

function updateActiveSocketConnectionsGauge() {
  metrics.setActiveSocketConnections(activeSockets.size);
}

function updateConnectedUsersGauge() {
  metrics.setConnectedUsers(connectedUsersTotal);
}

/**
 * @param {BoardData} board
 * @returns {AppSocket[]}
 */
function detachBoardSockets(board) {
  const socketIds = [...board.users];
  board.users.clear();
  if (socketIds.length > 0) {
    connectedUsersTotal = Math.max(0, connectedUsersTotal - socketIds.length);
    updateConnectedUsersGauge();
  }
  clearBoardUsers(board.name);
  /** @type {AppSocket[]} */
  const sockets = [];
  for (const socketId of socketIds) {
    const socket = activeSockets.get(socketId);
    if (socket) {
      sockets.push(socket);
      activeSockets.delete(socketId);
    }
    syncedPersistentSockets.delete(socketId);
  }
  updateActiveSocketConnectionsGauge();
  return sockets;
}

/**
 * @param {BoardData} board
 * @param {{
 *   actualFileSeq?: number,
 *   baselineSeq?: number,
 *   durationMs?: number,
 *   logEvent?: string,
 *   persistedFileSeq?: number,
 *   reason?: string,
 *   saveTargetSeq?: number,
 * }=} details
 * @returns {Promise<boolean>}
 */
async function dropLoadedBoardInstance(board, details) {
  const loadedBoard = getLoadedBoard(board.name);
  if (!loadedBoard) return false;
  const currentBoard = await loadedBoard;
  if (currentBoard !== board) return false;

  const socketsToDisconnect = detachBoardSockets(board);
  deleteLoadedBoard(board.name);
  updateLoadedBoardsGauge();
  board.dispose();

  logger.warn(
    details?.logEvent || "board.stale_instance_dropped",
    boardDebugFields(board, {
      "wbo.board.actual_file_seq": details?.actualFileSeq,
      "wbo.board.persisted_file_seq": details?.persistedFileSeq,
      "wbo.board.save_target_seq": details?.saveTargetSeq,
      "wbo.socket.baseline_seq": details?.baselineSeq,
      duration_ms: details?.durationMs,
      "wbo.board.disconnected_sockets": socketsToDisconnect.length,
      reason: details?.reason,
    }),
  );

  socketsToDisconnect.forEach((socket) => {
    closeSocket(socket, "stale_board", {
      board: board.name,
      socket: socket.id,
    });
  });
  return true;
}

/**
 * @param {BoardData} board
 * @param {{
 *   actualFileSeq?: number,
 *   durationMs?: number,
 *   saveTargetSeq?: number,
 * }=} details
 * @returns {Promise<void>}
 */
async function handleStaleBoardSave(board, details) {
  await dropLoadedBoardInstance(board, {
    ...details,
    reason: "save_seq_mismatch",
  });
}

/**
 * @param {MutationLogEntry} entry
 * @param {string | undefined} liveSocketId
 * @returns {SequencedMutationBroadcastData}
 */
function buildSequencedMutationBroadcast(entry, liveSocketId = undefined) {
  // The retained log entry has no source socket. Only the primary live
  // broadcast gets one so the sender can acknowledge its optimistic write.
  const mutation = liveSocketId
    ? { ...entry.mutation, socket: liveSocketId }
    : entry.mutation;
  return {
    seq: entry.seq,
    acceptedAtMs: entry.acceptedAtMs,
    mutation,
  };
}

/**
 * @param {AppSocket} socket
 * @param {string} eventName
 * @param {{[key: string]: any}} infos
 * @returns {void}
 */
function closeSocket(socket, eventName, infos) {
  void eventName;
  void infos;
  if (eventName === "report_user") {
    const closeConnection = socket.client?.conn?.close;
    if (typeof closeConnection === "function") {
      closeConnection.call(socket.client.conn);
      return;
    }
  }
  socket.disconnect(true);
}

/**
 * @param {string} socketId
 * @returns {AppSocket | undefined}
 */
function getActiveSocket(socketId) {
  return activeSockets.get(socketId);
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {{[key: string]: any}} extras
 * @returns {{[key: string]: any}}
 */
function buildSocketLogInfo(socket, boardName, extras) {
  return {
    board: boardName,
    socket: socket.id,
    ...extras,
  };
}

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
 * @param {string} boardName
 * @param {string | undefined} userName
 * @param {{tool?: unknown, type?: unknown}=} message
 * @returns {{[key: string]: unknown}}
 */
function boardMutationTraceAttributes(boardName, userName, message) {
  return socketTraceAttributes("broadcast_write", {
    "wbo.board": boardName,
    "user.name": userName,
    "wbo.tool": getToolId(message?.tool),
    "wbo.message.type": formatMessageTypeTag(message?.type),
  });
}

/**
 * @param {string} value
 * @returns {string}
 */
function boardMessageErrorType(value) {
  return value;
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
 * @param {AppSocket} socket
 * @param {string} eventName
 * @param {string} reason
 * @param {{[key: string]: unknown}=} extras
 * @returns {void}
 */
function rejectSocketRequest(socket, eventName, reason, extras) {
  tracing.setActiveSpanAttributes({
    "wbo.board.result": "rejected",
    "wbo.rejection.reason": reason,
  });
  logger.warn("socket.request_rejected", {
    socket: socket.id,
    "wbo.socket.event": eventName,
    reason,
    ...(extras || {}),
  });
}

/**
 * @param {MessageData | undefined} data
 * @returns {boolean}
 */
function shouldTraceBroadcast(data) {
  return !data || data.tool !== Cursor.id;
}

/**
 * @param {AppSocket} socket
 * @param {string} clientIp
 * @returns {string}
 */
function getSocketUserName(socket, clientIp) {
  return buildUserName(clientIp, getSocketUserSecret(socket));
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {ServerConfig} config
 * @returns {string}
 */
function resolveClientIp(socket, boardName, config) {
  try {
    return getClientIp(config, socket);
  } catch (err) {
    if (!invalidIpSourceLogged) {
      invalidIpSourceLogged = true;
      logger.warn(
        "socket.ip_resolve_failed",
        buildSocketLogInfo(socket, boardName, {
          error: err,
        }),
      );
    }
    // Fallback to remoteAddress
    const request = getSocketRequest(socket);
    if (request.socket?.remoteAddress) {
      return request.socket.remoteAddress;
    }
    return "unknown";
  }
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {void}
 */
function ensureSocketJoinedBoard(socket, boardName) {
  if (!socket.rooms.has(boardName)) socket.join(boardName);
}

/**
 * @param {AppSocket} socket
 * @returns {boolean}
 */
function canReceiveLivePersistentBroadcasts(socket) {
  return syncedPersistentSockets.has(socket.id);
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
 * @returns {Promise<ConnectionReplayBootstrap>}
 */
async function prepareConnectionReplay(socket, config) {
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

/**
 * @param {BoardData} board
 * @param {AppSocket} sourceSocket
 * @param {SequencedMutationBroadcastData} broadcast
 * @returns {void}
 */
function emitPersistentBoardMutation(board, sourceSocket, broadcast) {
  for (const socketId of board.users) {
    const targetSocket = getActiveSocket(socketId);
    if (!targetSocket) continue;
    if (targetSocket.id === sourceSocket.id) continue;
    if (!canReceiveLivePersistentBroadcasts(targetSocket)) continue;
    targetSocket.emit(SocketEvents.BROADCAST, broadcast);
  }
  sourceSocket.emit(SocketEvents.BROADCAST, broadcast);
}

/**
 * @param {BoardData} board
 * @param {AppSocket} sourceSocket
 * @param {MutationLogEntry[] | undefined} followup
 * @returns {void}
 */
function emitPersistentBoardFollowupMutations(board, sourceSocket, followup) {
  if (!Array.isArray(followup) || followup.length === 0) return;
  followup.forEach((entry) => {
    emitPersistentBoardMutation(
      board,
      sourceSocket,
      buildSequencedMutationBroadcast(entry),
    );
  });
}

/**
 * @param {string} boardName
 * @param {AppSocket} sourceSocket
 * @param {NormalizedMessageData} livePayload
 * @returns {void}
 */
function emitEphemeralBoardMutation(boardName, sourceSocket, livePayload) {
  sourceSocket.broadcast
    .to(boardName)
    .emit(SocketEvents.BROADCAST, livePayload);
}

/**
 * @param {string} reason
 * @returns {void}
 */
function rejectActiveBoardMutation(reason) {
  tracing.setActiveSpanAttributes({
    "wbo.board.result": "rejected",
    "wbo.rejection.reason": reason,
  });
}

/**
 * @param {AppSocket} socket
 * @param {{clientMutationId?: unknown} | null | undefined} data
 * @param {string} reason
 * @returns {void}
 */
function emitMutationRejected(socket, data, reason) {
  const clientMutationId =
    typeof data?.clientMutationId === "string" && data.clientMutationId
      ? data.clientMutationId
      : undefined;
  /** @type {{reason: string, clientMutationId?: string}} */
  const payload = { reason };
  if (clientMutationId) {
    payload.clientMutationId = clientMutationId;
  }
  socket.emit(SocketEvents.MUTATION_REJECTED, payload);
}

/**
 * @param {string} boardName
 * @param {MessageData | undefined} data
 * @returns {void}
 */
function rejectTurnstileRequired(boardName, data) {
  rejectActiveBoardMutation("turnstile_validation_required");
  metrics.recordBoardMessage(
    { board: boardName, ...(data || {}) },
    boardMessageErrorType("turnstile.validation_required"),
  );
}

/**
 * @param {AppSocket} socket
 * @param {BoardData} board
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {string} clientIp
 * @param {string} userName
 * @returns {boolean}
 */
function rejectBlockedBoardWrite(
  socket,
  board,
  boardName,
  data,
  clientIp,
  userName,
) {
  rejectActiveBoardMutation("write_blocked");
  logger.warn("board.write_blocked", {
    socket: socket.id,
    board: board.name,
    "client.address": clientIp,
    "user.name": userName,
    tool: getToolId(data.tool),
    type: getMutationType(data),
  });
  metrics.recordBoardMessage(
    { board: boardName, ...data },
    boardMessageErrorType("write"),
  );
  emitMutationRejected(socket, data, "write_blocked");
  return false;
}

/**
 * @param {AppSocket} socket
 * @param {BoardData} board
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {string} clientIp
 * @param {string} userName
 * @param {string} reason
 * @returns {boolean}
 */
function rejectBoardMessageWrite(
  socket,
  board,
  boardName,
  data,
  clientIp,
  userName,
  reason,
) {
  rejectActiveBoardMutation(reason);
  logger.warn("board.message_rejected", {
    socket: socket.id,
    board: board.name,
    "client.address": clientIp,
    "user.name": userName,
    tool: getToolId(data.tool),
    type: getMutationType(data),
    reason,
  });
  metrics.recordBoardMessage(
    { board: boardName, ...data },
    boardMessageErrorType("board_message"),
  );
  emitMutationRejected(socket, data, reason);
  return false;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {number} now
 * @param {string} userName
 * @returns {{user: BoardUser | undefined, liveData: NormalizedMessageData}}
 */
function recordSuccessfulBoardWrite(socket, boardName, data, now, userName) {
  const user = updateBoardUserFromMessage(socket, boardName, data, now);
  const liveData = user ? { ...data, socket: user.socketId } : data;
  tracing.setActiveSpanAttributes({
    "wbo.board.result": "success",
    "user.name": user ? user.name : userName,
  });
  metrics.recordBoardMessage({
    board: boardName,
    ...liveData,
  });
  return { user, liveData };
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {number} now
 * @param {string} userName
 * @returns {void}
 */
function finishSuccessfulEphemeralBoardWrite(
  socket,
  boardName,
  data,
  now,
  userName,
) {
  const { liveData } = recordSuccessfulBoardWrite(
    socket,
    boardName,
    data,
    now,
    userName,
  );
  emitEphemeralBoardMutation(boardName, socket, liveData);
}

/**
 * @param {AppSocket} socket
 * @param {BoardData} board
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {number} now
 * @param {string} userName
 * @param {MutationLogEntry} entry
 * @param {MutationLogEntry[] | undefined} followup
 * @returns {void}
 */
function finishSuccessfulPersistentBoardWrite(
  socket,
  board,
  boardName,
  data,
  now,
  userName,
  entry,
  followup,
) {
  const { user } = recordSuccessfulBoardWrite(
    socket,
    boardName,
    data,
    now,
    userName,
  );
  const liveBroadcast = buildSequencedMutationBroadcast(
    entry,
    user?.socketId || socket.id,
  );
  emitPersistentBoardMutation(board, socket, liveBroadcast);
  emitPersistentBoardFollowupMutations(board, socket, followup);
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {string} clientIp
 * @param {string} userName
 * @param {number} now
 * @param {ServerConfig} config
 * @returns {Promise<void>}
 */
async function persistBoardBroadcast(
  socket,
  boardName,
  data,
  clientIp,
  userName,
  now,
  config,
) {
  ensureSocketJoinedBoard(socket, boardName);
  const board = await getBoard(boardName, config);
  if (!canApplyBoardMessage(config, board, data, socket)) {
    rejectBlockedBoardWrite(socket, board, boardName, data, clientIp, userName);
    return;
  }
  if (data.tool === Cursor.id) {
    finishSuccessfulEphemeralBoardWrite(socket, boardName, data, now, userName);
    return;
  }

  const handleResult = await getBoardSession(board).acceptPersistentMutation(
    data,
    now,
  );
  if (handleResult.ok === false) {
    rejectBoardMessageWrite(
      socket,
      board,
      boardName,
      data,
      clientIp,
      userName,
      handleResult.reason,
    );
    emitPersistentBoardFollowupMutations(board, socket, handleResult.followup);
    return;
  }
  if (handleResult.value !== data) {
    Object.assign(data, handleResult.value);
  }
  finishSuccessfulPersistentBoardWrite(
    socket,
    board,
    boardName,
    handleResult.value,
    now,
    userName,
    handleResult.entry,
    handleResult.followup,
  );
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData | undefined} data
 * @param {RateLimitState} generalRateLimit
 * @param {number} now
 * @param {ServerConfig} config
 * @returns {Promise<void>}
 */
async function handleBroadcastWriteMessage(
  socket,
  boardName,
  data,
  generalRateLimit,
  now,
  config,
) {
  const clientIp = resolveClientIp(socket, boardName, config);
  const userName = getSocketUserName(socket, clientIp);
  tracing.setActiveSpanAttributes(
    boardMutationTraceAttributes(boardName, userName, data),
  );
  if (
    config.TURNSTILE_SECRET_KEY &&
    data &&
    WBOMessageCommon.requiresTurnstile(boardName, data.tool) &&
    !isTurnstileValidationActive(socket, now)
  ) {
    rejectTurnstileRequired(boardName, data);
    return;
  }
  if (
    !enforceBroadcastPreNormalization(
      socket,
      boardName,
      data,
      clientIp,
      userName,
      generalRateLimit,
      now,
      config,
    )
  ) {
    return;
  }

  const normalized = normalizeBroadcastData(config, boardName, data);
  if (normalized.ok === false) {
    rejectActiveBoardMutation(normalized.reason);
    emitMutationRejected(socket, data, normalized.reason);
    return;
  }
  const normalizedData = normalized.value;
  tracing.setActiveSpanAttributes(
    boardMutationTraceAttributes(boardName, userName, normalizedData),
  );
  if (
    !enforceBroadcastPostNormalization(
      socket,
      boardName,
      normalizedData,
      clientIp,
      userName,
      now,
      config,
    )
  ) {
    return;
  }
  await persistBoardBroadcast(
    socket,
    boardName,
    normalizedData,
    clientIp,
    userName,
    now,
    config,
  );
}

/**
 * @param {any} app
 * @param {ServerConfig} config
 * @returns {Promise<import("socket.io").Server>}
 */
async function startIO(app, config) {
  io = new Server(app);
  io.use(
    (
      /** @type {AppSocket} */ socket,
      /** @type {(error?: Error) => void} */ next,
    ) => {
      prepareConnectionReplay(socket, config)
        .then((replay) => {
          if (replay.ok === true) {
            socket.replayBootstrap = replay;
            next();
            return;
          }
          next(createConnectionReplayError(replay));
        })
        .catch((error) => {
          next(error instanceof Error ? error : new Error(String(error)));
        });
    },
  );
  io.on(
    "connection",
    wrapSocketEventHandler(function onConnection(socket) {
      return handleSocketConnection(socket, config);
    }, "connection"),
  );
  return io;
}

/** Returns a promise to a BoardData with the given name
 * @param {string} name
 * @param {ServerConfig} config
 * @returns {Promise<BoardData>}
 */
function getBoard(name, config) {
  const loadedBoard = getLoadedBoard(name);
  if (loadedBoard) {
    if (logger.isEnabled("debug")) {
      logger.debug("board.cache_hit", {
        board: name,
      });
    }
    return loadedBoard;
  } else {
    const board = BoardData.load(name, config).then((loaded) => {
      /**
       * @param {{actualFileSeq?: number, durationMs?: number, saveTargetSeq?: number}} details
       * @returns {Promise<void>}
       */
      loaded.onStaleSave = function onStaleSave(details) {
        return handleStaleBoardSave(loaded, details);
      };
      return loaded;
    });
    setLoadedBoard(name, board);
    updateLoadedBoardsGauge();
    if (logger.isEnabled("debug")) {
      logger.debug("board.cache_miss", {
        board: name,
      });
    }
    return board;
  }
}

/**
 * Executes on every new connection
 * @param {AppSocket} socket
 * @param {ConnectionReplayBootstrap & {ok: true}} replay
 * @param {ServerConfig} config
 * @returns {Promise<void>}
 */
async function bootstrapSocketBoard(socket, replay, config) {
  const { board, boardName } = replay;
  const replayCount = replay.replayBatch._children.length;
  return tracing.withActiveSpan(
    "socket.connect_board",
    {
      kind: tracing.SpanKind.INTERNAL,
      attributes: socketTraceAttributes("connect_board", {
        "wbo.board": boardName,
      }),
    },
    async function traceConnectBoard() {
      ensureSocketJoinedBoard(socket, boardName);
      if (logger.isEnabled("debug")) {
        logger.debug(
          "socket.board_bootstrap",
          boardDebugFields(board, {
            socket: socket.id,
            "wbo.socket.baseline_seq": replay.baselineSeq,
            "wbo.socket.latest_seq": replay.latestSeq,
          }),
        );
      }
      const wasJoined = board.users.has(socket.id);
      board.users.add(socket.id);
      if (!wasJoined || !getBoardUserMap(boardName).has(socket.id)) {
        const user = ensureBoardUser(
          socket,
          boardName,
          config,
          resolveClientIp,
        );
        if (!wasJoined) {
          connectedUsersTotal += 1;
          updateConnectedUsersGauge();
        }
        emitBoardUsersToSocket(socket, boardName);
        emitUserJoinedToBoard(socket, boardName, user);
        tracing.setActiveSpanAttributes({
          "user.name": user.name,
          "wbo.board.users": board.users.size,
          "wbo.board.result": "success",
          "wbo.socket.replay.count": replayCount,
        });
        logger.info("board.joined", {
          board: boardName,
          socket: socket.id,
          "user.name": user.name,
          "client.address": user.ip,
          users: board.users.size,
          "wbo.socket.replay.count": replayCount,
        });
      }
      socket.emit(SocketEvents.BOARDSTATE, {
        readonly: board.isReadOnly(),
        canWrite: canWriteToBoard(config, board, socket),
      });
      syncedPersistentSockets.delete(socket.id);
      socket.emit(SocketEvents.BROADCAST, replay.replayBatch);
      syncedPersistentSockets.add(socket.id);
      tracing.setActiveSpanAttributes({
        "wbo.socket.replay.outcome": replay.outcome,
        "wbo.socket.replay.count": replayCount,
        "wbo.socket.baseline_seq": replay.baselineSeq,
        "wbo.socket.latest_seq": replay.latestSeq,
      });
    },
  );
}

/**
 * Executes on every new connection
 * @param {AppSocket} socket
 * @param {ServerConfig} config
 */
async function handleSocketConnection(socket, config) {
  const replayBootstrap = /** @type {ConnectionReplayBootstrap | undefined} */ (
    socket.replayBootstrap
  );
  const replay =
    replayBootstrap?.ok === true
      ? replayBootstrap
      : await prepareConnectionReplay(socket, config);
  if (replay.ok === false) {
    rejectSocketRequest(socket, "connection", replay.reason);
    closeSocket(socket, "connection", { reason: replay.reason });
    return;
  }
  const boardName = replay.boardName;
  activeSockets.set(socket.id, socket);
  updateActiveSocketConnectionsGauge();
  metrics.recordSocketConnection("connected");

  onSocketEvent(socket, "error", function onSocketError(error) {
    logger.error("socket.error", {
      socket: socket.id,
      error: error,
    });
  });

  onSocketEvent(
    socket,
    "turnstile_token",
    async function onTurnstileToken(
      /** @type {string} */ token,
      /** @type {TurnstileAckCallback | undefined} */ ack,
    ) {
      return tracing.withActiveSpan(
        "socket.turnstile_token",
        {
          kind: tracing.SpanKind.INTERNAL,
          attributes: socketTraceAttributes("turnstile_token"),
        },
        async function traceTurnstileToken() {
          return handleTurnstileTokenMessage(
            socket,
            boardName,
            token,
            ack,
            config,
            resolveClientIp,
            getSocketUserName,
          );
        },
      );
    },
  );

  const generalRateLimit = createRateLimitState(Date.now());
  onSocketEvent(
    socket,
    "broadcast",
    async function onBroadcast(/** @type {MessageData | undefined} */ data) {
      const now = Date.now();
      const normalizedName = boardName;

      async function handleBroadcastWrite() {
        return handleBroadcastWriteMessage(
          socket,
          normalizedName,
          data,
          generalRateLimit,
          now,
          config,
        );
      }

      if (!shouldTraceBroadcast(data)) {
        return handleBroadcastWrite();
      }

      return tracing.withActiveSpan(
        "socket.broadcast_write",
        {
          kind: tracing.SpanKind.INTERNAL,
          attributes: boardMutationTraceAttributes(
            normalizedName,
            undefined,
            data,
          ),
        },
        handleBroadcastWrite,
      );
    },
  );

  onSocketEvent(
    socket,
    "report_user",
    function onReportUser(
      /** @type {ReportUserPayload | undefined} */ message,
    ) {
      const normalizedName = boardName;
      return tracing.withActiveSpan(
        "socket.report_user",
        {
          kind: tracing.SpanKind.INTERNAL,
          attributes: socketTraceAttributes("report_user", {
            "wbo.board": normalizedName,
          }),
        },
        function traceReportUser() {
          handleReportUserMessage(
            socket,
            normalizedName,
            message,
            getActiveSocket,
            closeSocket,
          );
        },
      );
    },
  );

  socket.on(
    "disconnecting",
    function onDisconnecting(/** @type {string} */ _reason) {
      recordCompletedRateLimitWindow("general", generalRateLimit, "disconnect");
      activeSockets.delete(socket.id);
      syncedPersistentSockets.delete(socket.id);
      updateActiveSocketConnectionsGauge();
      metrics.recordSocketConnection("disconnected");
      socket.rooms.forEach(
        async function disconnectFrom(/** @type {string} */ room) {
          const boardPromise = getLoadedBoard(room);
          if (boardPromise) {
            const board = await boardPromise;
            if (logger.isEnabled("debug")) {
              logger.debug(
                "socket.board_disconnecting",
                boardDebugFields(board, {
                  socket: socket.id,
                }),
              );
            }
            const removed = board.users.delete(socket.id);
            removeBoardUser(socket, room);
            const userCount = board.users.size;
            if (removed) {
              connectedUsersTotal = Math.max(0, connectedUsersTotal - 1);
              updateConnectedUsersGauge();
            }
            if (logger.isEnabled("debug")) {
              logger.debug(
                "socket.board_disconnected",
                boardDebugFields(board, {
                  socket: socket.id,
                  "wbo.board.user_removed": removed,
                }),
              );
            }
            if (userCount === 0 && !shuttingDown) unloadBoard(room);
          }
        },
      );
    },
  );

  await bootstrapSocketBoard(socket, replay, config);
}

/**
 * Unloads a board from memory.
 * @param {string} boardName
 **/
async function unloadBoard(boardName) {
  const loadedBoard = getLoadedBoard(boardName);
  if (loadedBoard) {
    return tracing.withOptionalActiveSpan(
      "board.unload",
      {
        attributes: {
          "wbo.board": boardName,
          "wbo.board.operation": "unload",
        },
      },
      async function traceBoardUnload() {
        const startedAt = Date.now();
        const board = await loadedBoard;
        if (logger.isEnabled("debug")) {
          logger.debug("board.unload_started", boardDebugFields(board));
        }
        try {
          const saveResult = await board.save();
          if (saveResult.status === "stale") {
            if (logger.isEnabled("debug")) {
              logger.debug("board.unload_stale", boardDebugFields(board));
            }
            return;
          }
          if (saveResult.status === "failed" && !shuttingDown) {
            logger.warn(
              "board.unload_aborted_save_failed",
              boardDebugFields(board),
            );
            return;
          }
          if (board.users.size > 0) {
            if (logger.isEnabled("debug")) {
              logger.debug("board.unload_aborted", boardDebugFields(board));
            }
            return;
          }
          const minPinnedBaselineSeq = getMinPinnedReplayBaselineSeq(
            boardName,
            Date.now(),
          );
          if (
            minPinnedBaselineSeq !== null &&
            minPinnedBaselineSeq < board.getPersistedSeq()
          ) {
            const nextReplayPinExpiry = getNextReplayPinExpiry(
              boardName,
              Date.now(),
            );
            if (nextReplayPinExpiry !== null) {
              const retryDelayMs = Math.max(
                1,
                nextReplayPinExpiry - Date.now(),
              );
              setTimeout(() => {
                void unloadBoard(boardName);
              }, retryDelayMs);
            }
            if (logger.isEnabled("debug")) {
              logger.debug(
                "board.unload_delayed_for_replay_pins",
                boardDebugFields(board, {
                  "wbo.board.min_pinned_baseline_seq": minPinnedBaselineSeq,
                }),
              );
            }
            return;
          }
          discardPinnedReplayBaselinesBefore(
            boardName,
            board.getPersistedSeq(),
            Date.now(),
          );
          board.dispose();
          if (logger.isEnabled("debug")) {
            logger.debug("board.unload_completed", boardDebugFields(board));
          }
          tracing.setActiveSpanAttributes({
            "wbo.board": boardName,
            "wbo.board.result": "success",
          });
          metrics.recordBoardOperationDuration(
            "unload",
            boardName,
            (Date.now() - startedAt) / 1000,
          );
          deleteLoadedBoard(boardName);
          updateLoadedBoardsGauge();
        } catch (error) {
          tracing.recordActiveSpanError(error, {
            "wbo.board": boardName,
            "wbo.board.result": "error",
          });
          metrics.recordBoardOperationDuration(
            "unload",
            boardName,
            (Date.now() - startedAt) / 1000,
            error,
          );
          throw error;
        }
      },
    );
  }
}

/**
 * Persist and unload every loaded board.
 * @returns {Promise<void>}
 */
async function shutdownBoards() {
  const currentIo = io;
  shuttingDown = true;
  io = undefined;
  if (currentIo) {
    currentIo.disconnectSockets(true);
    currentIo.engine.close();
  }
  const loadedBoards = listLoadedBoards();
  await Promise.all(
    loadedBoards.map(async (boardName) => {
      const board = await /** @type {Promise<BoardData>} */ (
        getLoadedBoard(boardName)
      );
      board.users.clear();
      return unloadBoard(boardName);
    }),
  );
  resetBoardRegistry();
}

export const __test = {
  buildBoardUserRecord: function buildBoardUserRecordForTest(
    /** @type {AppSocket} */ socket,
    /** @type {string} */ boardName,
    /** @type {ServerConfig} */ config,
    /** @type {number | undefined} */ now,
  ) {
    return createBoardUserRecord(
      socket,
      boardName,
      config,
      resolveClientIp,
      now,
    );
  },
  buildUserId,
  buildUserName,
  handleSocketConnection: function handleSocketConnectionForTest(
    /** @type {AppSocket} */ socket,
    /** @type {ServerConfig} */ config,
  ) {
    return handleSocketConnection(socket, config);
  },
  consumeFixedWindowRateLimit,
  countDestructiveActions,
  countConstructiveActions,
  countTextCreationActions,
  createRateLimitState,
  getClientIp,
  normalizeBroadcastData,
  prepareConnectionReplay,
  pruneRateLimitMap,
  cleanupBoardUserMap,
  getBoardUserMap,
  boardUserDebugFields,
  getLoadedBoard: function getLoadedBoardForTest(/** @type {string} */ name) {
    return getLoadedBoard(name);
  },
  getLastUserReportLog: function getLastUserReportLog() {
    return getLastSocketUserReportLog();
  },
  resetRateLimitMaps: function resetRateLimitMaps() {
    resetSocketRateLimitMaps();
    resetBoardUserMaps();
    activeSockets.clear();
    syncedPersistentSockets.clear();
    connectedUsersTotal = 0;
    resetSocketReports();
    invalidIpSourceLogged = false;
    shuttingDown = false;
    io = undefined;
    resetBoardRegistry();
  },
};

export { shutdownBoards as shutdown, startIO as start };
