import { canGrantTemporaryModeratorOnBoard } from "./policy.mjs";
import { getBoardUser } from "./presence.mjs";
import {
  grantTemporaryModerator,
  revokeTemporaryModerator,
} from "./temporary_moderators.mjs";

const DURATIONS = new Set([
  0,
  15 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
]);

/** @import { AppSocket, ServerConfig, SetTemporaryModeratorPayload } from "../../types/server-runtime.d.ts" */
/** @typedef {{socket: AppSocket, boardName: string, message: SetTemporaryModeratorPayload | undefined, config: ServerConfig, now: number, getActiveSocket: (socketId: string) => AppSocket | undefined, refreshUserAccess: (boardName: string, userSecret: string) => Promise<void>}} Context */

/** @param {Context} context */
export async function handleSetTemporaryModeratorMessage(context) {
  const { socket, boardName, message, config } = context;
  const socketId =
    typeof message?.socketId === "string" ? message.socketId : "";
  const durationMs = message?.durationMs;
  if (
    !socketId ||
    !Number.isSafeInteger(durationMs) ||
    !DURATIONS.has(/** @type {number} */ (durationMs)) ||
    !socket.rooms.has(boardName)
  ) {
    return;
  }
  if (!canGrantTemporaryModeratorOnBoard(config, boardName, socket)) {
    return;
  }

  const actor = getBoardUser(boardName, socket.id);
  const target = getBoardUser(boardName, socketId);
  const targetSocket = context.getActiveSocket(socketId);
  if (!actor || !target || !targetSocket?.rooms.has(boardName)) {
    return;
  }
  if (
    !target.userSecret ||
    actor.socketId === target.socketId ||
    actor.userSecret === target.userSecret
  ) {
    return;
  }
  if (canGrantTemporaryModeratorOnBoard(config, boardName, targetSocket)) {
    return;
  }

  if (durationMs) {
    grantTemporaryModerator(
      boardName,
      target.userSecret,
      context.now + durationMs,
    );
  } else {
    revokeTemporaryModerator(boardName, target.userSecret);
  }
  await context.refreshUserAccess(boardName, target.userSecret);
}
