import observability from "../observability/index.mjs";
import { MODERATION_RULE_IDS } from "../../client-data/js/moderation_rules.js";
import {
  ModerationDisconnectSources,
  SocketEvents,
} from "../../client-data/js/socket_events.js";
import { banBoardUser, normalizeBanTtlMs } from "./bans.mjs";
import { getBoardUser, getBoardUserMap } from "./presence.mjs";
import { canBanOnBoard, canReportOnBoard } from "./policy.mjs";

const { logger, tracing } = observability;
const MODERATION_DISCONNECT_CLOSE_TIMEOUT_MS = 150;

/** @import { AppSocket, ModerationDisconnectPayload, ModerationDisconnectSource, ReportUserPayload, ServerConfig } from "../../types/server-runtime.d.ts" */
/** @typedef {{socketId: string, userId: string, name: string, ip: string, userSecret: string, userAgent: string, language: string, canClear?: boolean}} BoardUser */
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
 * @param {ReportUserPayload | undefined} message
 * @returns {string | undefined}
 */
function getModeratorRule(message) {
  return typeof message?.moderationRule === "string" &&
    MODERATION_RULE_IDS.has(message.moderationRule)
    ? message.moderationRule
    : undefined;
}

/**
 * @param {ReportUserPayload | undefined} message
 * @returns {number}
 */
function getModeratorBanDurationMs(message) {
  if (
    typeof message?.banDurationMs === "number" &&
    message.banDurationMs === 0
  ) {
    return 0;
  }
  return normalizeBanTtlMs(message?.banDurationMs);
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
 * @param {string} boardName
 * @param {AppSocket} targetSocket
 * @param {CloseSocket} closeSocket
 * @param {{banDurationMs: number, source: ModerationDisconnectSource, moderationRule?: string}} details
 * @returns {void}
 */
function notifyModerationDisconnectThenClose(
  boardName,
  targetSocket,
  closeSocket,
  { banDurationMs, source, moderationRule },
) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeout = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    disconnectReportSocket(boardName, targetSocket, closeSocket);
  };
  /** @type {ModerationDisconnectPayload} */
  const payload = {
    banDurationMs: Math.max(0, Math.floor(banDurationMs)),
    source,
  };
  if (moderationRule !== undefined) payload.moderationRule = moderationRule;
  targetSocket.emit(SocketEvents.MODERATION_DISCONNECT, payload, close);
  if (closed) return;
  timeout = setTimeout(close, MODERATION_DISCONNECT_CLOSE_TIMEOUT_MS);
  timeout.unref?.();
}

/**
 * @param {BoardUser} reporter
 * @param {BoardUser} reported
 * @returns {boolean}
 */
function isSelfReportTarget(reporter, reported) {
  return (
    reporter.socketId === reported.socketId ||
    hasSameUserIdentity(reporter, reported)
  );
}

/**
 * @param {BoardUser} first
 * @param {BoardUser} second
 * @returns {boolean}
 */
function hasSameUserIdentity(first, second) {
  return first.userSecret !== "" && first.userSecret === second.userSecret;
}

/**
 * @param {ReportUserContext} context
 * @param {{reporter: BoardUser, reported: BoardUser}} users
 * @param {number} banDurationMs
 * @param {string | undefined} moderationRule
 * @returns {void}
 */
function handleReportByModerator(
  context,
  { reporter, reported },
  banDurationMs,
  moderationRule,
) {
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

  if (banDurationMs > 0) {
    banBoardUser(
      context.boardName,
      reported.userSecret,
      reported.ip,
      context.now,
      banDurationMs,
    );
  }

  const reportedSocket = context.getActiveSocket(reported.socketId);
  if (!reportedSocket) {
    logger.error("user.ban.fail", { reported, reporter, board });
    return;
  }
  notifyModerationDisconnectThenClose(
    board,
    reportedSocket,
    context.closeSocket,
    {
      banDurationMs,
      source: ModerationDisconnectSources.MODERATOR,
      ...(moderationRule === undefined ? {} : { moderationRule }),
    },
  );
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
    notifyModerationDisconnectThenClose(
      context.boardName,
      reportedSocket,
      context.closeSocket,
      {
        banDurationMs: 0,
        source: ModerationDisconnectSources.PEER_REPORT,
      },
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

  const canModerate = canBanOnBoard(config, boardName, socket);
  if (!canReportOnBoard(config, boardName, socket)) {
    ignoreReportedUser("blocked_reporter_ignored");
    return;
  }

  if (canModerate) {
    const banDurationMs = getModeratorBanDurationMs(message);
    const moderationRule = getModeratorRule(message);
    const reportLog = buildUserReportLog(
      boardName,
      resolvedUsers,
      banDurationMs > 0,
    );
    lastUserReportLog = reportLog;
    logger.warn("user.reported", reportLog);
    handleReportByModerator(
      context,
      resolvedUsers,
      banDurationMs,
      moderationRule,
    );
    return;
  }

  if (isSelfReportTarget(resolvedUsers.reporter, resolvedUsers.reported)) {
    ignoreReportedUser("self_report_ignored");
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
  const reportLog = buildUserReportLog(boardName, resolvedUsers, false);
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
