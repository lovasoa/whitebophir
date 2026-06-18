import observability from "../observability/index.mjs";
import { SocketEvents } from "../../client-data/js/socket_events.js";
import { banBoardUser } from "./bans.mjs";
import { getBoardUser, getBoardUserMap } from "./presence.mjs";
import { canBanOnBoard } from "./policy.mjs";

const { logger, tracing } = observability;

/** @import { AppSocket, ReportUserPayload, ServerConfig } from "../../types/server-runtime.d.ts" */
/** @typedef {{socketId: string, name: string, ip: string, userSecret?: string, userAgent: string, language: string, canClear?: boolean}} BoardUser */
/** @typedef {{board: string, reporter_socket: string, reported_socket: string, reporter_ip: string, reported_ip: string, reporter_user_agent: string, reported_user_agent: string, reporter_language: string, reported_language: string, reporter_name: string, reported_name: string, banned: boolean}} UserReportLog */
/** @typedef {(socketId: string) => AppSocket | undefined} GetActiveSocket */
/** @typedef {(socket: AppSocket, eventName: string, infos: {[key: string]: any}) => void} CloseSocket */
/** @typedef {{socket: AppSocket, boardName: string, message: ReportUserPayload | undefined, config: ServerConfig, now: number, getActiveSocket: GetActiveSocket, closeSocket: CloseSocket}} ReportUserContext */
/** @typedef {{reporter: BoardUser, reported: BoardUser}} ReportUsers */

/** @type {UserReportLog | null} */
let lastUserReportLog = null;

/**
 * @param {ReportUserPayload | undefined} message
 * @returns {string}
 */
function getReportedSocketId(message) {
  return typeof message?.socketId === "string" ? message.socketId : "";
}

/**
 * @param {string} boardName
 * @param {string} reporterSocketId
 * @param {string} reportedSocketId
 * @returns {ReportUsers | null}
 */
function resolveReportedUsers(boardName, reporterSocketId, reportedSocketId) {
  const reporter = getBoardUser(boardName, reporterSocketId);
  const reported = getBoardUser(boardName, reportedSocketId);
  if (!reporter || !reported) return null;
  return { reporter, reported };
}

/**
 * @returns {void}
 */
function ignoreReportedUser(result = "ignored") {
  tracing.setActiveSpanAttributes({
    "wbo.board.result": result,
  });
}

/**
 * Creates an object with properties to log a user report.
 * @param {string} boardName
 * @param {ReportUsers} users
 * @param {boolean} banned
 * @returns {UserReportLog}
 */
function buildUserReportLog(boardName, { reported, reporter }, banned) {
  return {
    board: boardName,
    reporter_socket: reporter.socketId,
    reported_socket: reported.socketId,
    reporter_ip: reporter.ip,
    reported_ip: reported.ip,
    reporter_user_agent: reporter.userAgent,
    reported_user_agent: reported.userAgent,
    reporter_language: reporter.language,
    reported_language: reported.language,
    reporter_name: reporter.name,
    reported_name: reported.name,
    banned,
  };
}

/**
 * @param {ReportUserContext} context
 * @param {ReportUsers} users
 * @returns {void}
 */
function notifyBoardModeratorsOfReport(context, users) {
  const payload = {
    reporterName: users.reporter.name,
    reportedName: users.reported.name,
  };
  getBoardUserMap(context.boardName).forEach(function notifyUser(user) {
    if (!user.canClear) return;
    const socket = context.getActiveSocket(user.socketId);
    if (!socket) return;
    socket.emit(SocketEvents.USER_REPORTED, payload);
  });
}

/**
 * @param {string} boardName
 * @param {AppSocket} targetSocket
 * @param {CloseSocket} closeSocket
 * @returns {void}
 */
function disconnectReportSocket(boardName, targetSocket, closeSocket) {
  closeSocket(targetSocket, "report_user", {
    board: boardName,
    socket: targetSocket.id,
  });
}

/**
 * @param {BoardUser} reporter
 * @param {BoardUser} reported
 * @returns {boolean}
 */
function isSelfReportTarget(reporter, reported) {
  return (
    reporter.socketId === reported.socketId ||
    (reporter.userSecret !== undefined &&
      reporter.userSecret !== "" &&
      reporter.userSecret === reported.userSecret)
  );
}

/**
 * @param {ReportUserContext} context
 * @param {{reporter: BoardUser, reported: BoardUser}} users
 * @returns {void}
 */
function handleReportByModerator(context, { reporter, reported }) {
  const board = context.boardName;
  if (isSelfReportTarget(reporter, reported)) {
    tracing.setActiveSpanAttributes({
      "wbo.board.result": "self_report_ignored",
    });
    logger.warn("user.ban_skipped_self_report", {
      board,
      reporter_socket: reporter.socketId,
      reported_socket: reported.socketId,
      reporter_name: reporter.name,
      reported_name: reported.name,
    });
    return;
  }

  banBoardUser(
    context.boardName,
    reported.userSecret,
    reported.ip,
    context.now,
  );
  logger.warn("user.banned", {
    board,
    reported_ip: reported.ip,
    reported_name: reported.name,
    by: reporter.name,
  });
  const reportedSocket = context.getActiveSocket(reported.socketId);
  if (!reportedSocket) {
    logger.error("user.ban.fail", { reported, reporter, board });
    return;
  }
  disconnectReportSocket(board, reportedSocket, context.closeSocket);
}

/**
 * @param {ReportUserContext} context
 * @returns {void}
 */
function disconnectReporter(context) {
  disconnectReportSocket(
    context.boardName,
    context.socket,
    context.closeSocket,
  );
}

/**
 * @param {ReportUserContext} context
 * @param {BoardUser} reported
 * @returns {void}
 */
function disconnectReported(context, reported) {
  const reportedSocket = context.getActiveSocket(reported.socketId);
  if (reportedSocket && reportedSocket !== context.socket) {
    disconnectReportSocket(
      context.boardName,
      reportedSocket,
      context.closeSocket,
    );
  }
}

/**
 * @param {ReportUserContext} context
 * @returns {void}
 */
function handleReportUserMessage(context) {
  const { message, boardName, socket, config } = context;
  const targetSocketId = getReportedSocketId(message);
  if (!targetSocketId || !socket.rooms.has(boardName)) {
    ignoreReportedUser();
    return;
  }

  const resolvedUsers = resolveReportedUsers(
    boardName,
    socket.id,
    targetSocketId,
  );
  if (!resolvedUsers) {
    ignoreReportedUser();
    return;
  }

  const banned = canBanOnBoard(config, boardName, socket);

  if (banned) {
    handleReportByModerator(context, resolvedUsers);
    return;
  }

  if (resolvedUsers.reported.canClear === true) {
    handleReportedModerator(context, boardName, resolvedUsers);
    return;
  }

  tracing.setActiveSpanAttributes({
    "wbo.board.result": "reported",
    "user.name": resolvedUsers.reporter.name,
    "wbo.reported_user.name": resolvedUsers.reported.name,
  });
  const reportLog = buildUserReportLog(boardName, resolvedUsers, banned);
  lastUserReportLog = reportLog;
  logger.warn("user.reported", reportLog);
  notifyBoardModeratorsOfReport(context, resolvedUsers);

  // Disconnect the reporter too to prevent abuse.
  disconnectReporter(context);
  disconnectReported(context, resolvedUsers.reported);
}

/**
 *
 * @param {ReportUserContext} context
 * @param {string} board
 * @param {ReportUsers} resolvedUsers
 */
function handleReportedModerator(context, board, resolvedUsers) {
  disconnectReporter(context);
  ignoreReportedUser("protected_report_ignored");
  logger.warn("user.report_skipped_protected_target", {
    board,
    reporter_socket: resolvedUsers.reporter.socketId,
    reported_socket: resolvedUsers.reported.socketId,
    reporter_name: resolvedUsers.reporter.name,
    reported_name: resolvedUsers.reported.name,
  });
}

/**
 * @returns {UserReportLog | null}
 */
function getLastUserReportLog() {
  return lastUserReportLog;
}

/**
 * @returns {void}
 */
function resetSocketReports() {
  lastUserReportLog = null;
}

export { getLastUserReportLog, handleReportUserMessage, resetSocketReports };
