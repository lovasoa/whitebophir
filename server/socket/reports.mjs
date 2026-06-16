import observability from "../observability/index.mjs";
import { banBoardUser } from "./bans.mjs";
import { getBoardUser } from "./presence.mjs";
import { canBanOnBoard } from "./policy.mjs";

const { logger, tracing } = observability;

/** @import { AppSocket, ReportUserPayload, ServerConfig } from "../../types/server-runtime.d.ts" */
/** @typedef {{socketId: string, name: string, ip: string, userSecret?: string, userAgent: string, language: string}} BoardUser */
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
function ignoreReportedUser() {
  tracing.setActiveSpanAttributes({
    "wbo.board.result": "ignored",
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
 * @param {string} boardName
 * @param {AppSocket[]} socketsToDisconnect
 * @param {CloseSocket} closeSocket
 * @returns {void}
 */
function disconnectReportedSockets(
  boardName,
  socketsToDisconnect,
  closeSocket,
) {
  socketsToDisconnect.forEach(
    function disconnectReportedUser(/** @type {AppSocket} */ targetSocket) {
      closeSocket(targetSocket, "report_user", {
        board: boardName,
        socket: targetSocket.id,
      });
    },
  );
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
function handleModeratorReport(context, users) {
  if (isSelfReportTarget(users.reporter, users.reported)) {
    tracing.setActiveSpanAttributes({
      "wbo.board.result": "self_report_ignored",
    });
    logger.warn("user.ban_skipped_self_report", {
      board: context.boardName,
      reporter_socket: users.reporter.socketId,
      reported_socket: users.reported.socketId,
      reporter_name: users.reporter.name,
      reported_name: users.reported.name,
    });
    return;
  }

  banBoardUser(
    context.boardName,
    users.reported.userSecret,
    users.reported.ip,
    context.now,
  );
  logger.warn("user.banned", {
    board: context.boardName,
    reported_ip: users.reported.ip,
    reported_name: users.reported.name,
    by: users.reporter.name,
  });
  const reportedSocket = context.getActiveSocket(users.reported.socketId);
  disconnectReportedSockets(
    context.boardName,
    reportedSocket ? [reportedSocket] : [],
    context.closeSocket,
  );
}

/**
 * @param {ReportUserContext} context
 * @param {{reporter: BoardUser, reported: BoardUser}} users
 * @returns {void}
 */
function handleLegacyReportDisconnect(context, users) {
  const reportedSocket = context.getActiveSocket(users.reported.socketId);
  disconnectReportedSockets(
    context.boardName,
    [
      context.socket,
      ...(reportedSocket && reportedSocket !== context.socket
        ? [reportedSocket]
        : []),
    ],
    context.closeSocket,
  );
}

/**
 * @param {ReportUserContext} context
 * @returns {void}
 */
function handleReportUserMessage(context) {
  const targetSocketId = getReportedSocketId(context.message);
  if (!targetSocketId || !context.socket.rooms.has(context.boardName)) {
    ignoreReportedUser();
    return;
  }

  const resolvedUsers = resolveReportedUsers(
    context.boardName,
    context.socket.id,
    targetSocketId,
  );
  if (!resolvedUsers) {
    ignoreReportedUser();
    return;
  }

  const banned = canBanOnBoard(
    context.config,
    context.boardName,
    context.socket,
  );

  const reportLog = buildUserReportLog(
    context.boardName,
    resolvedUsers,
    banned,
  );
  lastUserReportLog = reportLog;
  tracing.setActiveSpanAttributes({
    "wbo.board.result": "reported",
    "user.name": resolvedUsers.reporter.name,
    "wbo.reported_user.name": resolvedUsers.reported.name,
  });

  if (banned) {
    handleModeratorReport(context, resolvedUsers);
    return;
  }

  logger.warn("user.reported", reportLog);

  handleLegacyReportDisconnect(context, resolvedUsers);
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
