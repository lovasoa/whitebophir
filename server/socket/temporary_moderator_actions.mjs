import observability from "../observability/index.mjs";
import { canGrantTemporaryModeratorOnBoard } from "./policy.mjs";
import { getBoardUser } from "./presence.mjs";
import {
  grantTemporaryModerator,
  MAX_TEMPORARY_MODERATOR_TTL_MS,
  revokeTemporaryModerator,
} from "./temporary_moderators.mjs";

const { logger, tracing } = observability;

/** @import { AppSocket, ServerConfig, SetTemporaryModeratorAck, SetTemporaryModeratorPayload } from "../../types/server-runtime.d.ts" */
/** @typedef {(boardName: string, userSecret: string) => Promise<void>} RefreshUserAccess */
/** @typedef {{socket: AppSocket, boardName: string, message: SetTemporaryModeratorPayload | undefined, ack: SetTemporaryModeratorAck | undefined, config: ServerConfig, now: number, getActiveSocket: (socketId: string) => AppSocket | undefined, refreshUserAccess: RefreshUserAccess}} TemporaryModeratorActionContext */

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
  const durationMs = message?.durationMs;
  if (
    !socketId ||
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
  const target = getBoardUser(boardName, socketId);
  const targetSocket = context.getActiveSocket(socketId);
  if (
    !actor ||
    !target ||
    !targetSocket ||
    !targetSocket.rooms.has(boardName)
  ) {
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
    );
  }
  if (durationMs > 0 && expiresAt === null) {
    acknowledge(context.ack, { ok: false, reason: "invalid_request" });
    return;
  }

  await context.refreshUserAccess(boardName, target.userSecret);
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
