import WBOMessageCommon from "../../client-data/js/message_common.js";
import {
  formatMessageTypeTag,
  getMutationType,
  getToolId,
  MutationType,
} from "../../client-data/js/message_tool_metadata.js";
import { SocketEvents } from "../../client-data/js/socket_events.js";
import { TOOL_CODE_BY_ID } from "../../client-data/tools/manifest.js";
import { getBoardSession } from "../board/session.mjs";
import observability from "../observability/index.mjs";
import {
  boardPermissionsForSocket,
  normalizeBroadcastData,
} from "./policy.mjs";
import { getBoardUser, updateBoardUserFromMessage } from "./presence.mjs";
import {
  enforceBroadcastPostNormalization,
  enforceBroadcastPreNormalization,
} from "./rate_limits.mjs";
import { isTurnstileValidationActive } from "./turnstile.mjs";
import { reportPersonalInformation } from "./reports.mjs";

const { logger, metrics, tracing } = observability;

/** @import { AppSocket, MessageData, MutationLogEntry, NormalizedMessageData, SequencedMutationBroadcastData, ServerConfig } from "../../types/server-runtime.d.ts" */
/** @import { BoardData } from "../board/data.mjs" */
/**
 * @typedef {{
 *   getActiveSocket: (socketId: string) => AppSocket | undefined,
 *   getBoard: (name: string, config: ServerConfig) => Promise<BoardData>,
 *   getSocketUserName: (socket: AppSocket, clientIp: string) => string,
 *   isSyncedPersistentSocket: (socket: AppSocket) => boolean,
 *   resolveClientIp: (socket: AppSocket, boardName: string, config: ServerConfig) => string,
 * }} SocketBroadcastRuntime
 */

/**
 * @param {string} boardName
 * @param {string | undefined} userName
 * @param {{tool?: unknown, type?: unknown}=} message
 * @returns {{[key: string]: unknown}}
 */
function boardMutationTraceAttributes(boardName, userName, message) {
  return {
    "wbo.socket.event": "broadcast_write",
    "wbo.board": boardName,
    "user.name": userName,
    "wbo.tool": getToolId(message?.tool),
    "wbo.message.type": formatMessageTypeTag(message?.type),
  };
}

/**
 * @param {MessageData | undefined} data
 * @returns {boolean}
 */
function shouldTraceBroadcast(data) {
  return !data || data.tool !== TOOL_CODE_BY_ID.cursor;
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
 * @param {BoardData} board
 * @param {AppSocket} sourceSocket
 * @param {SequencedMutationBroadcastData} broadcast
 * @param {SocketBroadcastRuntime} runtime
 * @returns {void}
 */
function emitPersistentBoardMutation(board, sourceSocket, broadcast, runtime) {
  for (const socketId of board.users) {
    const targetSocket = runtime.getActiveSocket(socketId);
    if (!targetSocket) continue;
    if (targetSocket.id === sourceSocket.id) continue;
    if (!runtime.isSyncedPersistentSocket(targetSocket)) continue;
    targetSocket.emit(SocketEvents.BROADCAST, broadcast);
  }
  sourceSocket.emit(SocketEvents.BROADCAST, broadcast);
}

/**
 * @param {string} reason
 * @returns {void}
 */
function markBoardMutationRejected(reason) {
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
 * @param {AppSocket} socket
 * @param {BoardData} board
 * @param {NormalizedMessageData} data
 * @param {string} clientIp
 * @param {string} userName
 * @param {string} reason
 * @returns {void}
 */
function rejectBoardWrite(socket, board, data, clientIp, userName, reason) {
  const blocked = reason === "write_blocked";
  markBoardMutationRejected(reason);
  logger.warn(blocked ? "board.write_blocked" : "board.message_rejected", {
    socket: socket.id,
    board: board.name,
    "client.address": clientIp,
    "user.name": userName,
    tool: getToolId(data.tool),
    type: getMutationType(data),
    ...(blocked ? {} : { reason }),
  });
  metrics.recordBoardMessage(
    { board: board.name, ...data },
    blocked ? "write" : "board_message",
  );
  emitMutationRejected(socket, data, reason);
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {number} now
 * @param {string} userName
 */
function recordSuccessfulBoardWrite(socket, boardName, data, now, userName) {
  const user = updateBoardUserFromMessage(socket, boardName, data, now);
  tracing.setActiveSpanAttributes({
    "wbo.board.result": "success",
    "user.name": user ? user.name : userName,
  });
  metrics.recordBoardMessage({
    board: boardName,
    ...data,
    ...(user ? { socket: user.socketId } : {}),
  });
  return user;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {MessageData | undefined} data
 * @param {number} now
 * @param {ServerConfig} config
 * @param {SocketBroadcastRuntime} runtime
 * @returns {Promise<void>}
 */
async function handleBroadcastWriteMessage(
  socket,
  boardName,
  data,
  now,
  config,
  runtime,
) {
  // Presence already owns the identity derived from this connection's handshake.
  const user = getBoardUser(boardName, socket.id);
  const clientIp =
    user?.ip ?? runtime.resolveClientIp(socket, boardName, config);
  const userName = user?.name ?? runtime.getSocketUserName(socket, clientIp);
  tracing.setActiveSpanAttributes(
    boardMutationTraceAttributes(boardName, userName, data),
  );
  if (
    !enforceBroadcastPreNormalization({
      socket,
      boardName,
      data,
      clientIp,
      userName,
      now,
      config,
    })
  ) {
    return;
  }
  const permissions = boardPermissionsForSocket(config, boardName, socket);
  const capabilities = permissions.resolveCapabilities({ name: boardName });
  if (
    config.TURNSTILE_SECRET_KEY &&
    data &&
    capabilities.canClear !== true &&
    WBOMessageCommon.requiresTurnstile(boardName, data.tool) &&
    !isTurnstileValidationActive(socket, now)
  ) {
    markBoardMutationRejected("turnstile_validation_required");
    metrics.recordBoardMessage(
      { board: boardName, ...data },
      "turnstile.validation_required",
    );
    return;
  }

  const normalized = normalizeBroadcastData(
    config,
    boardName,
    data,
    capabilities,
  );
  if (normalized.ok === false) {
    markBoardMutationRejected(normalized.reason);
    emitMutationRejected(socket, data, normalized.reason);
    return;
  }
  const normalizedData = normalized.value;
  tracing.setActiveSpanAttributes(
    boardMutationTraceAttributes(boardName, userName, normalizedData),
  );
  const board = await runtime.getBoard(boardName, config);
  const boardState = permissions.boardState(board);
  if (
    !enforceBroadcastPostNormalization({
      socket,
      boardName,
      data: normalizedData,
      clientIp,
      userName,
      now,
      config,
      boardState,
    })
  ) {
    return;
  }
  if (!socket.rooms.has(boardName)) socket.join(boardName);
  if (!permissions.canApplyBoardMessage(board, normalizedData)) {
    rejectBoardWrite(
      socket,
      board,
      normalizedData,
      clientIp,
      userName,
      "write_blocked",
    );
    return;
  }
  if (normalizedData.tool === TOOL_CODE_BY_ID.cursor) {
    const user = recordSuccessfulBoardWrite(
      socket,
      boardName,
      normalizedData,
      now,
      userName,
    );
    socket.broadcast
      .to(boardName)
      .emit(
        SocketEvents.BROADCAST,
        user ? { ...normalizedData, socket: user.socketId } : normalizedData,
      );
    return;
  }

  const result = await getBoardSession(board).acceptPersistentMutation(
    normalizedData,
    now,
  );
  if (result.ok === false) {
    rejectBoardWrite(
      socket,
      board,
      normalizedData,
      clientIp,
      userName,
      result.reason,
    );
  } else {
    const user = recordSuccessfulBoardWrite(
      socket,
      boardName,
      result.value,
      now,
      userName,
    );
    emitPersistentBoardMutation(
      board,
      socket,
      buildSequencedMutationBroadcast(
        result.entry,
        user?.socketId || socket.id,
      ),
      runtime,
    );
  }
  // A rejected primary write can still expire earlier items. Those accepted
  // followup mutations must reach every peer in sequence, without sender attribution.
  for (const entry of result.followup || []) {
    emitPersistentBoardMutation(
      board,
      socket,
      buildSequencedMutationBroadcast(entry),
      runtime,
    );
  }
  if (
    result.ok &&
    result.value.tool === TOOL_CODE_BY_ID.text &&
    result.value.type === MutationType.UPDATE
  ) {
    reportPersonalInformation(
      {
        socket,
        boardName,
        config,
        now,
        getActiveSocket: runtime.getActiveSocket,
      },
      result.value.txt,
    );
  }
}

export {
  boardMutationTraceAttributes,
  handleBroadcastWriteMessage,
  shouldTraceBroadcast,
};
