import observability from "./observability.mjs";
import { getBoardUser } from "./socket_presence.mjs";

const { logger, tracing } = observability;

/** @import { AppSocket, ReportUserPayload } from "../types/server-runtime.d.ts" */
/** @typedef {{socketId: string, name: string, ip: string, userAgent: string, language: string}} BoardUser */
/** @typedef {{board: string, reporter_socket: string, reported_socket: string, reporter_ip: string, reported_ip: string, reporter_user_agent: string, reported_user_agent: string, reporter_language: string, reported_language: string, reporter_name: string, reported_name: string}} UserReportLog */
/** @typedef {(socketId: string) => AppSocket | undefined} GetActiveSocket */
/** @typedef {(socket: AppSocket, eventName: string, infos: {[key: string]: any}) => void} CloseSocket */

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
 * @returns {{reporter: BoardUser, reported: BoardUser} | null}
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
 * @param {string} boardName
 * @param {BoardUser} reporter
 * @param {BoardUser} reported
 * @returns {UserReportLog}
 */
function buildUserReportLog(boardName, reporter, reported) {
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
  };
}

/**
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {BoardUser} reported
 * @param {GetActiveSocket} getActiveSocket
 * @param {CloseSocket} closeSocket
 * @returns {void}
 */
function disconnectReportedSockets(
  socket,
  boardName,
  reported,
  getActiveSocket,
  closeSocket,
) {
  const socketsToDisconnect = [socket];
  const reportedSocket = getActiveSocket(reported.socketId);
  if (reportedSocket && reportedSocket !== socket) {
    socketsToDisconnect.push(reportedSocket);
  }
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
 * @param {AppSocket} socket
 * @param {string} boardName
 * @param {ReportUserPayload | undefined} message
 * @param {GetActiveSocket} getActiveSocket
 * @param {CloseSocket} closeSocket
 * @returns {void}
 */
function handleReportUserMessage(
  socket,
  boardName,
  message,
  getActiveSocket,
  closeSocket,
) {
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

  const reportLog = buildUserReportLog(
    boardName,
    resolvedUsers.reporter,
    resolvedUsers.reported,
  );
  lastUserReportLog = reportLog;
  tracing.setActiveSpanAttributes({
    "wbo.board.result": "reported",
    "user.name": resolvedUsers.reporter.name,
    "wbo.reported_user.name": resolvedUsers.reported.name,
  });
  logger.warn("user.reported", {
    board: reportLog.board,
    reporter_socket: reportLog.reporter_socket,
    reported_socket: reportLog.reported_socket,
    reporter_ip: reportLog.reporter_ip,
    reported_ip: reportLog.reported_ip,
    reporter_user_agent: reportLog.reporter_user_agent,
    reported_user_agent: reportLog.reported_user_agent,
    reporter_language: reportLog.reporter_language,
    reported_language: reportLog.reported_language,
    reporter_name: reportLog.reporter_name,
    reported_name: reportLog.reported_name,
  });
  disconnectReportedSockets(
    socket,
    boardName,
    resolvedUsers.reported,
    getActiveSocket,
    closeSocket,
  );
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
