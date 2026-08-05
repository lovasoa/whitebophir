import { canGrantTemporaryModeratorOnBoard } from "./policy.mjs";
import { getBoardUser } from "./presence.mjs";
import {
  grantTemporaryModerator,
  MAX_TEMPORARY_MODERATOR_TTL_MS,
  revokeTemporaryModerator,
} from "./temporary_moderators.mjs";

const DURATIONS = new Set([
  0,
  15 * 60 * 1000,
  24 * 60 * 60 * 1000,
  MAX_TEMPORARY_MODERATOR_TTL_MS,
]);

/** @import { AppSocket, ServerConfig, SetTemporaryModeratorAck, SetTemporaryModeratorPayload } from "../../types/server-runtime.d.ts" */
/** @typedef {{socket: AppSocket, boardName: string, message: SetTemporaryModeratorPayload | undefined, ack: SetTemporaryModeratorAck | undefined, config: ServerConfig, now: number, getActiveSocket: (socketId: string) => AppSocket | undefined, refreshUserAccess: (boardName: string, userSecret: string) => Promise<void>}} Context */

/** @param {Context} context */
export async function handleSetTemporaryModeratorMessage(context) {
  const { socket, boardName, message, config } = context;
  /** @param {string} reason */
  const reject = (reason) => context.ack?.({ ok: false, reason });
  const socketId =
    typeof message?.socketId === "string" ? message.socketId : "";
  const durationMs = message?.durationMs;
  if (
    !socketId ||
    !Number.isSafeInteger(durationMs) ||
    !DURATIONS.has(/** @type {number} */ (durationMs)) ||
    !socket.rooms.has(boardName)
  ) {
    reject("invalid_request");
    return;
  }
  if (!canGrantTemporaryModeratorOnBoard(config, boardName, socket)) {
    reject("permission_denied");
    return;
  }

  const actor = getBoardUser(boardName, socket.id);
  const target = getBoardUser(boardName, socketId);
  const targetSocket = context.getActiveSocket(socketId);
  if (!actor || !target || !targetSocket?.rooms.has(boardName)) {
    reject("target_not_found");
    return;
  }
  if (
    !target.userSecret ||
    actor.socketId === target.socketId ||
    actor.userSecret === target.userSecret
  ) {
    reject("invalid_target");
    return;
  }
  if (canGrantTemporaryModeratorOnBoard(config, boardName, targetSocket)) {
    reject("protected_target");
    return;
  }

  if (durationMs) {
    grantTemporaryModerator(
      boardName,
      target.userSecret,
      context.now,
      durationMs,
    );
  } else {
    revokeTemporaryModerator(boardName, target.userSecret);
  }
  await context.refreshUserAccess(boardName, target.userSecret);
  context.ack?.({ ok: true });
}
