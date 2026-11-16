import observability from "../observability/index.mjs";
import { privateInfoKind } from "../../client-data/tools/text/personal_information.js";
import {
  MODERATION_DURATIONS,
  MODERATION_RULE_IDS,
} from "../../client-data/js/moderation_rules.js";
import {
  ModerationDisconnectSources,
  SocketEvents,
} from "../../client-data/js/socket_events.js";
import { banBoardUser } from "./bans.mjs";
import { getBoardUser, getBoardUserMap } from "./presence.mjs";
import { boardPermissionsForSocket } from "./policy.mjs";

const { logger, tracing } = observability;
const MODERATION_DISCONNECT_CLOSE_TIMEOUT_MS = 150;

/** @import { AppSocket, ModerationDisconnectPayload, ModerationDisconnectSource, ModeratorReportUserPayload, ReportUserPayload, ServerConfig } from "../../types/server-runtime.d.ts" */
/** @import { UserReportedPayload } from "../../types/app-runtime.d.ts" */
/** @typedef {{socketId: string, userId: string, name: string, ip: string, userSecret: string, userAgent: string, language: string}} BoardUser */
/** @typedef {{board: string, reporter_socket: string, reported_socket: string, reporter_ip: string, reported_ip: string, reporter_user_agent: string, reported_user_agent: string, reporter_language: string, reported_language: string, reporter_name: string, reported_name: string, banned: boolean}} UserReportLog */
/** @typedef {(socketId: string) => AppSocket | undefined} GetActiveSocket */
/** @typedef {(socket: AppSocket) => void} CloseSocket */
/** @typedef {{socket: AppSocket, boardName: string, message: unknown, config: ServerConfig, now: number, getActiveSocket: GetActiveSocket, closeSocket: CloseSocket, onBansChanged?: () => void}} ReportUserContext */

/** @type {UserReportLog | null} */
let lastUserReportLog = null;

/**
 * Reject shapes and values the current role's UI cannot send.
 * @param {unknown} message
 * @param {boolean} canModerate
 * @returns {ReportUserPayload | null}
 */
function validateReportUserPayload(message, canModerate) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return null;
  const payload = /** @type {Record<string, unknown>} */ (message);
  if (
    !Object.prototype.hasOwnProperty.call(payload, "socketId") ||
    typeof payload.socketId !== "string" ||
    !payload.socketId
  )
    return null;
  const keyCount = Object.keys(payload).length;
  if (!canModerate)
    return keyCount === 1 ? { socketId: payload.socketId } : null;
  if (
    keyCount !== 3 ||
    !Object.prototype.hasOwnProperty.call(payload, "banDurationMs") ||
    typeof payload.banDurationMs !== "number" ||
    !MODERATION_DURATIONS.has(payload.banDurationMs) ||
    !Object.prototype.hasOwnProperty.call(payload, "moderationRule") ||
    typeof payload.moderationRule !== "string" ||
    !MODERATION_RULE_IDS.has(payload.moderationRule)
  )
    return null;
  return {
    socketId: payload.socketId,
    banDurationMs: payload.banDurationMs,
    moderationRule: payload.moderationRule,
  };
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
 * @param {BoardUser} reporter
 * @param {BoardUser} reported
 * @param {boolean} banned
 * @returns {UserReportLog}
 */
function buildUserReportLog(boardName, reporter, reported, banned) {
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
 * @param {Pick<ReportUserContext, "boardName" | "config" | "getActiveSocket">} context
 * @param {UserReportedPayload} payload
 * @returns {boolean}
 */
function notifyBoardModeratorsOfReport(context, payload) {
  let notified = false;
  getBoardUserMap(context.boardName).forEach(function notifyUser(user) {
    const socket = context.getActiveSocket(user.socketId);
    if (
      !socket ||
      !socket.rooms.has(context.boardName) ||
      !boardPermissionsForSocket(
        context.config,
        context.boardName,
        socket,
      ).canBan()
    ) {
      return;
    }
    socket.emit(SocketEvents.USER_REPORTED, payload);
    notified = true;
  });
  return notified;
}

/** Only accepted publications can trigger this server-owned alert. Never include
 * the detected personal information in notifications or logs.
 * @param {Pick<ReportUserContext, "socket" | "boardName" | "config" | "now" | "getActiveSocket">} context
 * @param {string} text
 */
export function reportPersonalInformation(context, text) {
  // Live text updates arrive while typing; do not flood moderators per keystroke.
  if (
    context.socket.personalInfoReportAt !== undefined &&
    context.now - context.socket.personalInfoReportAt < 60_000
  )
    return;
  if (privateInfoKind(text) === null) return;
  const user = getBoardUser(context.boardName, context.socket.id);
  if (!user) return;
  const notified = notifyBoardModeratorsOfReport(context, {
    reporterName: "",
    reportedName: user.name,
    automatic: true,
  });
  if (!notified) return;
  context.socket.personalInfoReportAt = context.now;
  logger.warn("user.auto_reported", {
    board: context.boardName,
    reported_socket: user.socketId,
    reported_name: user.name,
    moderationRule: "personal_information",
  });
}

/**
 * @param {AppSocket} targetSocket
 * @param {CloseSocket} closeSocket
 * @param {{banDurationMs: number, source: ModerationDisconnectSource, moderationRule?: string}} details
 * @returns {void}
 */
function notifyModerationDisconnectThenClose(
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
    closeSocket(targetSocket);
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
 * @param {ReportUserContext} context
 * @returns {void}
 */
function handleReportUserMessage(context) {
  const { boardName, socket, config } = context;
  if (!socket.rooms.has(boardName)) {
    ignoreReportedUser();
    return;
  }

  const permissions = boardPermissionsForSocket(config, boardName, socket);
  const canModerate = permissions.canBan();
  if (!permissions.canReport()) {
    ignoreReportedUser("blocked_reporter_ignored");
    return;
  }
  const message = validateReportUserPayload(context.message, canModerate);
  if (!message) {
    ignoreReportedUser("invalid_report_ignored");
    return;
  }
  const reporter = getBoardUser(boardName, socket.id);
  const reported = getBoardUser(boardName, message.socketId);
  if (!reporter || !reported) {
    ignoreReportedUser();
    return;
  }

  const selfTarget =
    reporter.socketId === reported.socketId ||
    (reporter.userSecret !== "" && reporter.userSecret === reported.userSecret);
  if (!canModerate && selfTarget) {
    ignoreReportedUser("self_report_ignored");
    return;
  }

  const reportedSocket = context.getActiveSocket(reported.socketId);
  if (!reportedSocket || !reportedSocket.rooms.has(boardName)) {
    ignoreReportedUser("target_not_found");
    return;
  }
  if (
    !selfTarget &&
    boardPermissionsForSocket(config, boardName, reportedSocket).canBan()
  ) {
    context.closeSocket(socket);
    ignoreReportedUser("protected_report_ignored");
    logger.warn("user.report_skipped_protected_target", {
      board: boardName,
      reporter_socket: reporter.socketId,
      reported_socket: reported.socketId,
      reporter_name: reporter.name,
      reported_name: reported.name,
    });
    return;
  }

  if (!canModerate) {
    tracing.setActiveSpanAttributes({
      "wbo.board.result": "reported",
      "user.name": reporter.name,
      "wbo.reported_user.name": reported.name,
    });
  }
  lastUserReportLog = buildUserReportLog(
    boardName,
    reporter,
    reported,
    canModerate &&
      /** @type {ModeratorReportUserPayload} */ (message).banDurationMs > 0,
  );
  logger.warn("user.reported", lastUserReportLog);

  if (canModerate) {
    if (selfTarget) {
      ignoreReportedUser("self_report_ignored");
      logger.warn("user.ban_skipped_self_report", {
        board: boardName,
        reporter_socket: reporter.socketId,
        reported_socket: reported.socketId,
        reporter_name: reporter.name,
        reported_name: reported.name,
      });
      return;
    }
    const { banDurationMs, moderationRule } =
      /** @type {ModeratorReportUserPayload} */ (message);
    if (banDurationMs > 0) {
      banBoardUser(
        boardName,
        reported.userSecret,
        reported.ip,
        context.now,
        banDurationMs,
        {
          name: reported.name,
          moderationRule,
        },
      );
      context.onBansChanged?.();
    }
    const targetSocket = context.getActiveSocket(reported.socketId);
    if (!targetSocket) {
      logger.error("user.ban.fail", { reported, reporter, board: boardName });
      return;
    }
    notifyModerationDisconnectThenClose(targetSocket, context.closeSocket, {
      banDurationMs,
      source: ModerationDisconnectSources.MODERATOR,
      moderationRule,
    });
    return;
  }

  notifyBoardModeratorsOfReport(context, {
    reporterName: reporter.name,
    reportedName: reported.name,
  });
  // Disconnect the reporter too to prevent abuse.
  context.closeSocket(socket);
  const targetSocket = context.getActiveSocket(reported.socketId);
  if (targetSocket && targetSocket !== socket) {
    notifyModerationDisconnectThenClose(targetSocket, context.closeSocket, {
      banDurationMs: 0,
      source: ModerationDisconnectSources.PEER_REPORT,
    });
  }
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
