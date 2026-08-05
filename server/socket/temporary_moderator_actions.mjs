import observability from "../observability/index.mjs";
import { canGrantTemporaryModeratorOnBoard } from "./policy.mjs";
import { getBoardUser } from "./presence.mjs";
import {
  grantTemporaryModerator,
  MAX_TEMPORARY_MODERATOR_TTL_MS,
  revokeTemporaryModerator,
  revokeTemporaryModeratorById,
} from "./temporary_moderators.mjs";

const { logger, tracing } = observability;

/** @import { AppSocket, ServerConfig, SetTemporaryModeratorAck, SetTemporaryModeratorPayload } from "../../types/server-runtime.d.ts" */
/** @typedef {(boardName: string, userSecret: string) => Promise<void>} RefreshUserAccess */
/** @typedef {(boardName: string) => Promise<void>} RefreshModeratorAccess */
/** @typedef {{socket: AppSocket, boardName: string, message: SetTemporaryModeratorPayload | undefined, ack: SetTemporaryModeratorAck | undefined, config: ServerConfig, now: number, getActiveSocket: (socketId: string) => AppSocket | undefined, refreshUserAccess: RefreshUserAccess, refreshModeratorAccess: RefreshModeratorAccess}} TemporaryModeratorActionContext */

/**
 * @param {SetTemporaryModeratorAck | undefined} ack
 * @param {{ok: true, expiresAt: number | null} | {ok: false, reason: string}} result
 */
function acknowledge(ack, result) {
  if (typeof ack === "function") ack(result);
}

/**
 * @param {TemporaryModeratorActionContext} context
 * @returns {Promise<void>}
 */
export async function handleSetTemporaryModeratorMessage(context) {
  const { message, socket, boardName, config } = context;
  const socketId =
    typeof message?.socketId === "string" ? message.socketId : "";
  const grantId = typeof message?.grantId === "string" ? message.grantId : "";
  const durationMs = message?.durationMs;
  if (
    (!socketId && !(durationMs === 0 && grantId)) ||
    typeof durationMs !== "number" ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 0 ||
    durationMs > MAX_TEMPORARY_MODERATOR_TTL_MS ||
    !socket.rooms.has(boardName)
  ) {
    acknowledge(context.ack, { ok: false, reason: "invalid_request" });
    return;
  }
  if (!canGrantTemporaryModeratorOnBoard(config, boardName, socket)) {
    acknowledge(context.ack, { ok: false, reason: "permission_denied" });
    return;
  }

  const actor = getBoardUser(boardName, socket.id);
  if (!actor) {
    acknowledge(context.ack, { ok: false, reason: "target_not_found" });
    return;
  }

  if (durationMs === 0 && grantId) {
    const revoked = revokeTemporaryModeratorById(boardName, grantId);
    if (!revoked) {
      acknowledge(context.ack, { ok: false, reason: "target_not_found" });
      return;
    }
    await context.refreshUserAccess(boardName, revoked.userSecret);
    await context.refreshModeratorAccess(boardName);
    tracing.setActiveSpanAttributes({
      "wbo.board.result": "revoked",
      "wbo.temporary_moderator.duration_ms": 0,
    });
    logger.info("temporary_moderator.revoked", {
      board: boardName,
      actor_socket: actor.socketId,
      target_socket: revoked.grant.user?.socketId,
      duration_ms: 0,
      expires_at: null,
    });
    acknowledge(context.ack, { ok: true, expiresAt: null });
    return;
  }

  const target = getBoardUser(boardName, socketId);
  const targetSocket = context.getActiveSocket(socketId);
  if (!target || !targetSocket || !targetSocket.rooms.has(boardName)) {
    acknowledge(context.ack, { ok: false, reason: "target_not_found" });
    return;
  }
  if (
    !target.userSecret ||
    actor.socketId === target.socketId ||
    (actor.userSecret !== "" && actor.userSecret === target.userSecret)
  ) {
    acknowledge(context.ack, { ok: false, reason: "invalid_target" });
    return;
  }
  if (canGrantTemporaryModeratorOnBoard(config, boardName, targetSocket)) {
    acknowledge(context.ack, { ok: false, reason: "protected_target" });
    return;
  }

  let expiresAt = null;
  if (durationMs === 0) {
    revokeTemporaryModerator(boardName, target.userSecret);
  } else {
    expiresAt = grantTemporaryModerator(
      boardName,
      target.userSecret,
      context.now,
      durationMs,
      {
        socketId: target.socketId,
        userId: target.userId,
        name: target.name,
        color: target.color,
        size: target.size,
        lastTool: target.lastTool,
        joinedAt: target.joinedAt,
        position: target.position,
      },
    );
  }
  if (durationMs > 0 && expiresAt === null) {
    acknowledge(context.ack, { ok: false, reason: "invalid_request" });
    return;
  }

  await context.refreshUserAccess(boardName, target.userSecret);
  await context.refreshModeratorAccess(boardName);
  tracing.setActiveSpanAttributes({
    "wbo.board.result": durationMs === 0 ? "revoked" : "granted",
    "wbo.temporary_moderator.duration_ms": durationMs,
  });
  logger.info(
    durationMs === 0
      ? "temporary_moderator.revoked"
      : "temporary_moderator.granted",
    {
      board: boardName,
      actor_socket: actor.socketId,
      target_socket: target.socketId,
      duration_ms: durationMs,
      expires_at: expiresAt,
    },
  );
  acknowledge(context.ack, { ok: true, expiresAt });
}
