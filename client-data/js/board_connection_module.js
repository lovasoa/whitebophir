import * as BoardMessageReplay from "./board_message_replay.js";
import { normalizeBoardState } from "./board_page_state.js";
import { getAuthoritativeBaselineUrl } from "./board_replay_module.js";
import { connection as BoardConnection } from "./board_transport.js";
import * as BoardTurnstile from "./board_turnstile.js";
import { getModerationRule } from "./moderation_rules.js";
import { ModerationDisconnectSources, SocketEvents } from "./socket_events.js";

/** @import { AppToolsState, BoardConnectionState, ModerationDisconnectPayload, SocketHeaders } from "../../types/app-runtime" */
/** @typedef {{banDurationMs: number, moderationRule?: string, source: import("../../types/app-runtime").ModerationDisconnectSource, acknowledged: boolean, disconnected: boolean}} PendingModerationDisconnect */
const ACCESS_REFRESH_GRACE_MS = 50;
const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;
/** @type {Promise<typeof io> | null} */
let socketIoReady = null;

/**
 * @returns {Promise<typeof io>}
 */
function whenSocketIoReady() {
  if (typeof io !== "undefined") return Promise.resolve(io);
  if (socketIoReady) return socketIoReady;

  socketIoReady = new Promise((resolve, reject) => {
    const script = document.getElementById("socketio-client");
    if (!(script instanceof HTMLScriptElement)) {
      reject(new Error("Missing Socket.IO client script."));
      return;
    }
    script.addEventListener(
      "load",
      () => {
        if (typeof io !== "undefined") {
          resolve(io);
        } else {
          reject(
            new Error("Socket.IO client script loaded without global io."),
          );
        }
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error("Socket.IO client script failed to load.")),
      { once: true },
    );
  });
  return socketIoReady;
}

/** @param {AppToolsState} Tools */
function getAttachedBoardDom(Tools) {
  return Tools.dom.status === "attached" ? Tools.dom : null;
}

/**
 * @param {unknown} payload
 * @returns {ModerationDisconnectPayload}
 */
export function normalizeModerationDisconnectPayload(payload) {
  /** @type {Record<string, unknown> | null} */
  const payloadRecord =
    payload !== null && typeof payload === "object"
      ? /** @type {Record<string, unknown>} */ (payload)
      : null;
  const hasExplicitBanDuration =
    payloadRecord !== null &&
    Object.prototype.hasOwnProperty.call(payloadRecord, "banDurationMs");
  const rawDuration = payloadRecord?.banDurationMs;
  const raw = typeof rawDuration === "number" ? rawDuration : 0;
  const moderationRule =
    payloadRecord !== null && "moderationRule" in payloadRecord
      ? getModerationRule(
          typeof payloadRecord.moderationRule === "string"
            ? payloadRecord.moderationRule
            : undefined,
        )?.id
      : undefined;
  const source =
    payloadRecord !== null &&
    payloadRecord.source === ModerationDisconnectSources.PEER_REPORT &&
    hasExplicitBanDuration &&
    typeof rawDuration === "number" &&
    Number.isFinite(rawDuration) &&
    rawDuration === 0 &&
    !("moderationRule" in payloadRecord)
      ? ModerationDisconnectSources.PEER_REPORT
      : ModerationDisconnectSources.MODERATOR;
  return {
    banDurationMs:
      Number.isFinite(raw) && raw > 0 ? Math.max(0, Math.floor(raw)) : 0,
    source,
    ...(moderationRule === undefined ? {} : { moderationRule }),
  };
}

/**
 * @param {ModerationDisconnectPayload} notice
 * @returns {{kind: "ban" | "report" | "warning", titleKey: string, messageKey: string}}
 */
export function getModerationDisconnectNoticeDescriptor(notice) {
  if (notice.source === ModerationDisconnectSources.PEER_REPORT) {
    return {
      kind: "report",
      titleKey: "peer_report_disconnect_title",
      messageKey: "peer_report_disconnect_body",
    };
  }
  return notice.banDurationMs > 0
    ? {
        kind: "ban",
        titleKey: "moderation_ban_title",
        messageKey: "moderation_ban_body",
      }
    : {
        kind: "warning",
        titleKey: "moderation_warning_title",
        messageKey: "moderation_warning_body",
      };
}

/**
 * Keeps access-refresh timers inside the browser's reliable timeout range.
 * Invalid server state cancels an existing timer instead of causing a rapid
 * reconnect loop.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function normalizeAccessRefreshDelayMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.min(
    Math.floor(value),
    MAX_BROWSER_TIMEOUT_MS - ACCESS_REFRESH_GRACE_MS,
  );
}

/**
 * @param {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} logBoardEvent
 * @returns {SocketHeaders | null}
 */
export function readSocketIOExtraHeaders(logBoardEvent) {
  let socketIOExtraHeaders = BoardConnection.normalizeSocketIOExtraHeaders(
    window.socketio_extra_headers,
  );
  if (!socketIOExtraHeaders) {
    try {
      const storedHeaders = sessionStorage.getItem("socketio_extra_headers");
      if (storedHeaders) {
        socketIOExtraHeaders = BoardConnection.normalizeSocketIOExtraHeaders(
          JSON.parse(storedHeaders),
        );
      }
    } catch (err) {
      logBoardEvent("warn", "boot.socket_headers_load_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (socketIOExtraHeaders) {
    window.socketio_extra_headers = socketIOExtraHeaders;
  }
  return socketIOExtraHeaders;
}

export class ConnectionModule {
  /**
   * @param {() => AppToolsState} getTools
   * @param {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} logBoardEvent
   */
  constructor(getTools, logBoardEvent) {
    this.getTools = getTools;
    this.logBoardEvent = logBoardEvent;
    this.socket = null;
    this.state = /** @type {BoardConnectionState} */ ("idle");
    this.hasConnectedOnce = false;
    this.socketIOExtraHeaders = /** @type {SocketHeaders | null} */ (null);
    this.pendingModerationDisconnect =
      /** @type {PendingModerationDisconnect | null} */ (null);
    this.accessRefreshTimerId = /** @type {number | null} */ (null);
  }

  cancelAccessRefresh() {
    if (this.accessRefreshTimerId === null) return;
    window.clearTimeout(this.accessRefreshTimerId);
    this.accessRefreshTimerId = null;
  }

  /**
   * Schedules one authoritative access refresh at the server-provided ban
   * boundary. Every newer board state replaces the timer; unrestricted state
   * cancels it. A short grace avoids reconnecting just before server expiry.
   *
   * @param {unknown} refreshAfterMs
   */
  scheduleAccessRefresh(refreshAfterMs) {
    this.cancelAccessRefresh();
    const delayMs = normalizeAccessRefreshDelayMs(refreshAfterMs);
    if (delayMs === null) return;
    this.accessRefreshTimerId = window.setTimeout(() => {
      this.accessRefreshTimerId = null;
      this.logBoardEvent("log", "access.expiry_refresh", { delayMs });
      this.start();
    }, delayMs + ACCESS_REFRESH_GRACE_MS);
  }

  /** @param {number} [delayMs] */
  scheduleSocketReconnect(delayMs = 250) {
    const Tools = this.getTools();
    window.setTimeout(() => Tools.connection.start(), Math.max(0, delayMs));
  }

  /** @param {PendingModerationDisconnect} notice */
  resumeAfterModerationDisconnect(notice) {
    if (this.pendingModerationDisconnect !== notice) return;
    if (!notice.acknowledged || !notice.disconnected) return;
    this.pendingModerationDisconnect = null;
    this.scheduleSocketReconnect(0);
  }

  start() {
    const Tools = this.getTools();
    const reusableSocket =
      this.socket && !this.socket.connected ? this.socket : null;
    if (this.socket && !reusableSocket) {
      BoardConnection.closeSocket(this.socket);
      this.socket = null;
    }
    this.state = "connecting";
    Tools.replay.awaitingSnapshot = true;
    Tools.presence.clearConnectedUsers();

    void (async () => {
      if (!getAttachedBoardDom(Tools)) {
        this.scheduleSocketReconnect();
        return;
      }
      if (Tools.replay.refreshBaselineBeforeConnect) {
        try {
          await Tools.replay.refreshAuthoritativeBaseline();
          Tools.replay.refreshBaselineBeforeConnect = false;
        } catch (error) {
          const nextReconnectDelayMs = 1000;
          this.logBoardEvent("warn", "replay.baseline_refresh_failed", {
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage:
              error instanceof Error ? error.message : String(error),
            baselineUrl: getAuthoritativeBaselineUrl(),
            nextReconnectDelayMs,
            navigatorOnline: navigator.onLine,
            documentVisibility: document.visibilityState,
            incomingBroadcastQueue: Tools.replay.incomingBroadcastQueue.length,
            bufferedWrites: Tools.writes.bufferedWrites.length,
            optimisticJournalSize: Tools.optimistic.journal.size(),
            pendingPreSnapshotMessages: Tools.replay.preSnapshotMessages.length,
          });
          this.scheduleSocketReconnect(nextReconnectDelayMs);
          return;
        }
      }

      const socketParams = BoardConnection.buildSocketParams(
        window.location.pathname,
        this.socketIOExtraHeaders,
        Tools.identity.token,
        Tools.identity.boardName,
        {
          baselineSeq: String(Tools.replay.authoritativeSeq),
          tool: Tools.preferences.initial.tool,
          color: Tools.preferences.getColor(),
          size: String(Tools.preferences.getSize()),
        },
      );

      if (reusableSocket) {
        if (reusableSocket.io) {
          reusableSocket.io.opts = {
            ...(reusableSocket.io.opts || {}),
            query: socketParams.query || "",
          };
        }
        reusableSocket.connect();
        return;
      }

      const ioClient = await whenSocketIoReady();
      const socket = ioClient.connect("", socketParams);
      this.socket = socket;

      // Receive draw instructions from the server.
      socket.on(SocketEvents.CONNECT, () => {
        const hadConnectedBefore = Tools.connection.hasConnectedOnce;
        Tools.connection.state = "connected";
        this.logBoardEvent(
          "log",
          hadConnectedBefore ? "socket.reconnected" : "socket.connected",
        );
        if (
          hadConnectedBefore &&
          Tools.config.serverConfig.TURNSTILE_SITE_KEY
        ) {
          Tools.turnstile.setValidation(null);
          BoardTurnstile.resetTurnstileWidget(
            BoardTurnstile.getTurnstileApi(),
            Tools.turnstile.widgetId,
          );
        }
        Tools.connection.hasConnectedOnce = true;
        Tools.status.syncWriteStatusIndicator();
      });
      socket.on(SocketEvents.BROADCAST, (msg) => {
        Tools.replay.enqueueIncomingBroadcast(msg);
      });
      socket.on(SocketEvents.BOARDSTATE, (boardState) => {
        Tools.access.applyBoardState(normalizeBoardState(boardState));
      });
      socket.on(
        SocketEvents.MUTATION_REJECTED,
        function onMutationRejected(payload) {
          if (payload.clientMutationId) {
            Tools.writes.resolveBufferedWrite(payload.clientMutationId);
            Tools.optimistic.rejectMutation(
              payload.clientMutationId,
              payload.reason,
            );
          }
          Tools.status.showUnknownMutationError(payload.reason);
        },
      );
      socket.on(SocketEvents.CONNECT_ERROR, (error) => {
        if (socket !== Tools.connection.socket) return;
        const data = error.data;
        const reason = data?.reason || error.message || "connect_error";
        this.logBoardEvent("warn", "socket.connect_error", {
          reason,
          ...(data?.latestSeq === undefined
            ? {}
            : { latestSeq: data.latestSeq }),
          ...(data?.minReplayableSeq === undefined
            ? {}
            : { minReplayableSeq: data.minReplayableSeq }),
          authoritativeSeq: Tools.replay.authoritativeSeq,
        });
        Tools.connection.state = "disconnected";
        if (reason === "baseline_not_replayable") {
          this.logBoardEvent("warn", "replay.baseline_not_replayable", {
            authoritativeSeq: Tools.replay.authoritativeSeq,
            latestSeq: BoardMessageReplay.normalizeSeq(data?.latestSeq),
            minReplayableSeq: BoardMessageReplay.normalizeSeq(
              data?.minReplayableSeq,
            ),
          });
          Tools.replay.beginAuthoritativeResync();
          if (socket === Tools.connection.socket) {
            Tools.connection.socket = null;
            BoardConnection.closeSocket(socket);
          }
        }
        this.scheduleSocketReconnect();
      });
      socket.on(SocketEvents.USER_JOINED, function onUserJoined(user) {
        Tools.presence.upsertConnectedUser(user);
      });
      socket.on(SocketEvents.USER_LEFT, function onUserLeft(user) {
        Tools.presence.removeConnectedUser(user.socketId);
      });
      socket.on(SocketEvents.USER_REPORTED, function onUserReported(payload) {
        Tools.status.showUserReportNotice(payload);
      });
      socket.on(
        SocketEvents.MODERATION_DISCONNECT,
        /**
         * @param {unknown} payload
         * @param {(() => void) | undefined} [ack]
         */
        function onModerationDisconnect(payload, ack) {
          const normalized = normalizeModerationDisconnectPayload(payload);
          const descriptor =
            getModerationDisconnectNoticeDescriptor(normalized);
          /** @type {PendingModerationDisconnect} */
          const notice = {
            banDurationMs: normalized.banDurationMs,
            moderationRule: normalized.moderationRule,
            source: normalized.source,
            acknowledged: false,
            disconnected: false,
          };
          Tools.connection.pendingModerationDisconnect = notice;
          if (typeof ack === "function") ack();
          const rule = getModerationRule(normalized.moderationRule);
          void Tools.ui
            .showModerationDisconnectNotice({
              banDurationMs: normalized.banDurationMs,
              kind: descriptor.kind,
              title: Tools.i18n.t(descriptor.titleKey),
              message: Tools.i18n.t(descriptor.messageKey),
              acknowledgeLabel: Tools.i18n.t("moderation_acknowledge"),
              rulesLabel: Tools.i18n.t("community_rules_link"),
              privateBoardLabel: Tools.i18n.t("create_private_board"),
              countdownLabel: Tools.i18n.t("moderation_countdown"),
              countdownDoneLabel: Tools.i18n.t("moderation_countdown_done"),
              countdownUnitPatterns: {
                day: Tools.i18n.t("relative_days_short"),
                hour: Tools.i18n.t("relative_hours_short"),
                minute: Tools.i18n.t("relative_minutes_short"),
                second: Tools.i18n.t("relative_seconds_short"),
              },
              ruleHeading: Tools.i18n.t("moderation_rule_focus"),
              ruleTitle: rule ? Tools.i18n.t(rule.titleKey) : undefined,
              ruleBody: rule ? Tools.i18n.t(rule.bodyKeys[0] || "") : undefined,
              ruleIconUrl: rule ? `../rules/${rule.iconFile}` : undefined,
              ruleAppealUrl: rule?.appealUrl,
              ruleAppealLabel: rule?.appealLabelKey
                ? Tools.i18n.t(rule.appealLabelKey)
                : undefined,
            })
            .then(() => {
              notice.acknowledged = true;
              Tools.connection.resumeAfterModerationDisconnect(notice);
            });
        },
      );
      socket.on(SocketEvents.RATE_LIMITED, function onRateLimited(payload) {
        const retryAfterMs = Math.max(0, Number(payload.retryAfterMs) || 0);
        Tools.writes.serverRateLimitedUntil = Date.now() + retryAfterMs;
        Tools.writes.deferBufferedWritesUntil(
          Tools.writes.serverRateLimitedUntil,
          true,
        );
        window.setTimeout(() => {
          Tools.writes.pumpBufferedWrites();
        }, retryAfterMs);
        Tools.status.showRateLimitNotice(
          Tools.i18n.t("rate_limit_disconnect_message"),
          retryAfterMs,
        );
        Tools.status.syncWriteStatusIndicator();
      });
      socket.on(SocketEvents.DISCONNECT, (reason) => {
        if (socket !== Tools.connection.socket) return;
        if (reason === "io client disconnect") return;
        Tools.connection.state = "disconnected";
        const moderationNotice = Tools.connection.pendingModerationDisconnect;
        if (moderationNotice) {
          moderationNotice.disconnected = true;
          this.logBoardEvent("warn", "socket.disconnected", {
            reason: SocketEvents.MODERATION_DISCONNECT,
            socketReason: reason,
            banDurationMs: moderationNotice.banDurationMs,
            source: moderationNotice.source,
          });
          Tools.replay.beginAuthoritativeResync();
          Tools.connection.resumeAfterModerationDisconnect(moderationNotice);
          return;
        }
        this.logBoardEvent("warn", "socket.disconnected", { reason });
        Tools.replay.beginAuthoritativeResync({
          preserveBufferedWrites: Tools.writes.isWritePaused(),
        });
        this.scheduleSocketReconnect();
      });
      socket.connect();
    })();
  }
}
