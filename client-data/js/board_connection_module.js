import * as BoardMessageReplay from "./board_message_replay.js";
import { getAuthoritativeBaselineUrl } from "./board_replay_module.js";
import { connection as BoardConnection } from "./board_transport.js";
import * as BoardTurnstile from "./board_turnstile.js";
import { SocketEvents } from "./socket_events.js";

/** @import { AppToolsState, BoardConnectionState, SocketHeaders } from "../../types/app-runtime" */

/** @param {AppToolsState} Tools */
function getAttachedBoardDom(Tools) {
  return Tools.dom.status === "attached" ? Tools.dom : null;
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
  }

  /** @param {number} [delayMs] */
  scheduleSocketReconnect(delayMs = 250) {
    const Tools = this.getTools();
    window.setTimeout(() => Tools.connection.start(), Math.max(0, delayMs));
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
          this.logBoardEvent("error", "replay.baseline_refresh_failed", {
            error: error instanceof Error ? error.message : String(error),
            baselineUrl: getAuthoritativeBaselineUrl(),
            pendingPreSnapshotMessages: Tools.replay.preSnapshotMessages.length,
          });
          this.scheduleSocketReconnect(1000);
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

      const socket = io.connect("", socketParams);
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
        Tools.access.applyBoardState(boardState);
      });
      socket.on(
        SocketEvents.MUTATION_REJECTED,
        function onMutationRejected(payload) {
          if (payload.clientMutationId) {
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
      socket.on(SocketEvents.RATE_LIMITED, function onRateLimited(payload) {
        const retryAfterMs = payload.retryAfterMs;
        Tools.writes.serverRateLimitedUntil =
          Date.now() + Math.max(0, retryAfterMs);
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
        this.logBoardEvent("warn", "socket.disconnected", { reason });
        Tools.replay.beginAuthoritativeResync();
        this.scheduleSocketReconnect();
      });
      socket.connect();
    })();
  }
}
