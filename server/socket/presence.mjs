import WBOMessageCommon from "../../client-data/js/message_common.js";
import {
  hasMessageColor,
  hasMessageSize,
} from "../../client-data/js/message_shape.js";
import { getToolId } from "../../client-data/js/message_tool_metadata.js";
import { SocketEvents } from "../../client-data/js/socket_events.js";
import { Cursor } from "../../client-data/tools/index.js";
import { buildPronounceableName } from "../shared/pronounceable_name.mjs";
import {
  getSocketHeaderValue,
  getSocketQueryValue,
  getSocketUserSecret,
} from "./request.mjs";

/** @import { AppSocket, ConnectedUserPayload, NormalizedMessageData, ServerConfig } from "../../types/server-runtime.d.ts" */
/** @typedef {{socketId: string, userId: string, userSecret: string, name: string, ip: string, userAgent: string, language: string, color: string, size: number, lastTool: string, lastSeen: number, lastFocusX: number, lastFocusY: number, canEdit: boolean, canClear: boolean}} BoardUser */
/** @typedef {(socket: AppSocket, boardName: string, config: ServerConfig) => string} ResolveClientIp */
/** @typedef {{canEdit: boolean, canClear: boolean}} UserCapabilities */

/** @type {Map<string, Map<string, BoardUser>>} */
const boardUsers = new Map();

/**
 * @param {string} userSecret
 * @returns {string}
 */
function buildUserId(userSecret) {
  return buildPronounceableName(userSecret || "anonymous", 2, 3);
}

/**
 * @param {string} ip
 * @param {string} userSecret
 * @returns {string}
 */
function buildUserName(ip, userSecret) {
  return `${buildPronounceableName(ip || "unknown", 2, 2)} ${buildUserId(
    userSecret,
  )}`;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {ServerConfig} config
 * @param {ResolveClientIp} resolveClientIp
 * @param {UserCapabilities} capabilities
 * @param {number} [now]
 * @returns {BoardUser}
 */
function buildBoardUserRecord(
  socket,
  boardName,
  config,
  resolveClientIp,
  capabilities,
  now,
) {
  const userSecret = getSocketUserSecret(socket);
  const ip = resolveClientIp(socket, boardName, config);
  const size = WBOMessageCommon.clampSize(
    parseInt(getSocketQueryValue(socket, "size"), 10),
  );
  const color = WBOMessageCommon.normalizeColor(
    getSocketQueryValue(socket, "color"),
  );
  return {
    socketId: socket.id,
    userId: buildUserId(userSecret),
    userSecret,
    name: buildUserName(ip, userSecret),
    ip,
    userAgent: getSocketHeaderValue(socket, "user-agent"),
    language: getSocketHeaderValue(socket, "accept-language"),
    color: color || "#001f3f",
    size,
    lastTool: getSocketQueryValue(socket, "tool") || "hand",
    lastSeen: now || Date.now(),
    lastFocusX: 0,
    lastFocusY: 0,
    canEdit: capabilities.canEdit,
    canClear: capabilities.canClear,
  };
}

/**
 * @param {string} boardName
 * @returns {Map<string, BoardUser>}
 */
function getBoardUserMap(boardName) {
  let users = boardUsers.get(boardName);
  if (users) return users;
  users = new Map();
  boardUsers.set(boardName, users);
  return users;
}

/**
 * @param {string} boardName
 * @returns {void}
 */
function cleanupBoardUserMap(boardName) {
  const users = boardUsers.get(boardName);
  if (users && users.size === 0) boardUsers.delete(boardName);
}

/**
 * @param {string} boardName
 * @returns {void}
 */
function clearBoardUsers(boardName) {
  const users = boardUsers.get(boardName);
  if (!users) return;
  users.clear();
  cleanupBoardUserMap(boardName);
}

/**
 * @param {BoardUser} user
 * @returns {ConnectedUserPayload}
 */
function serializeBoardUser(user) {
  return {
    socketId: user.socketId,
    userId: user.userId,
    name: user.name,
    color: user.color,
    size: user.size,
    lastTool: user.lastTool,
    lastFocusX: user.lastFocusX,
    lastFocusY: user.lastFocusY,
    canEdit: user.canEdit,
    canClear: user.canClear,
  };
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {ServerConfig} config
 * @param {ResolveClientIp} resolveClientIp
 * @param {UserCapabilities} capabilities
 * @returns {BoardUser}
 */
function ensureBoardUser(
  socket,
  boardName,
  config,
  resolveClientIp,
  capabilities,
) {
  const users = getBoardUserMap(boardName);
  const existing = users.get(socket.id);
  if (existing) return existing;

  const user = buildBoardUserRecord(
    socket,
    boardName,
    config,
    resolveClientIp,
    capabilities,
  );
  users.set(socket.id, user);
  return user;
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {void}
 */
function emitBoardUsersToSocket(socket, boardName) {
  const users = getBoardUserMap(boardName);
  users.forEach(function emitUserJoined(user) {
    socket.emit(SocketEvents.USER_JOINED, serializeBoardUser(user));
  });
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {BoardUser} user
 * @returns {void}
 */
function emitUserJoinedToBoard(socket, boardName, user) {
  socket.broadcast
    .to(boardName)
    .emit(SocketEvents.USER_JOINED, serializeBoardUser(user));
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @returns {void}
 */
function removeBoardUser(socket, boardName) {
  const users = getBoardUserMap(boardName);
  if (!users.delete(socket.id)) return;
  socket.broadcast.to(boardName).emit(SocketEvents.USER_LEFT, {
    socketId: socket.id,
  });
  cleanupBoardUserMap(boardName);
}

/**
 * @param {string} boardName
 * @param {string} socketId
 * @returns {BoardUser | undefined}
 */
function getBoardUser(boardName, socketId) {
  return getBoardUserMap(boardName).get(socketId);
}

/**
 * @param {string} boardName
 * @param {string} socketId
 * @returns {{[key: string]: unknown}}
 */
function boardUserDebugFields(boardName, socketId) {
  const user = getBoardUser(boardName, socketId);
  if (!user) return {};
  return {
    "user.name": user.name,
    "client.address": user.ip,
  };
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {NormalizedMessageData} data
 * @param {number} now
 * @returns {BoardUser | undefined}
 */
function updateBoardUserFromMessage(socket, boardName, data, now) {
  const user = getBoardUser(boardName, socket.id);
  if (!user) return undefined;

  user.lastSeen = now;
  if (hasMessageColor(data)) user.color = data.color;
  if (hasMessageSize(data)) user.size = data.size || user.size;
  const toolId = getToolId(data.tool);
  if (data.tool !== Cursor.id && toolId) user.lastTool = toolId;
  if (
    "x" in data &&
    "y" in data &&
    Number.isFinite(data.x) &&
    Number.isFinite(data.y)
  ) {
    user.lastFocusX = data.x;
    user.lastFocusY = data.y;
  }
  return user;
}

/**
 * @returns {void}
 */
function resetBoardUserMaps() {
  boardUsers.clear();
}

export {
  boardUserDebugFields,
  buildBoardUserRecord,
  buildUserId,
  buildUserName,
  cleanupBoardUserMap,
  clearBoardUsers,
  emitBoardUsersToSocket,
  emitUserJoinedToBoard,
  ensureBoardUser,
  getBoardUser,
  getBoardUserMap,
  removeBoardUser,
  resetBoardUserMaps,
  updateBoardUserFromMessage,
};
