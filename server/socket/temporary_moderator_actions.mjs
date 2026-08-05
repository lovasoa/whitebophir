import { canGrantTemporaryModeratorOnBoard } from "./policy.mjs";
import { getBoardUser } from "./presence.mjs";
import { setTemporaryModerator } from "./temporary_moderators.mjs";

const DURATIONS = [0, 900_000, 86_400_000, 604_800_000];

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
    !DURATIONS.includes(/** @type {number} */ (durationMs)) ||
    !socket.rooms.has(boardName)
  ) {
    return;
  }
  if (!canGrantTemporaryModeratorOnBoard(config, boardName, socket)) return;

  const actor = getBoardUser(boardName, socket.id);
  const target = getBoardUser(boardName, socketId);
  const targetSocket = context.getActiveSocket(socketId);
  if (!actor || !target || !targetSocket?.rooms.has(boardName)) return;
  if (!target.userSecret || actor.userSecret === target.userSecret) {
    return;
  }
  if (canGrantTemporaryModeratorOnBoard(config, boardName, targetSocket))
    return;

  setTemporaryModerator(
    boardName,
    target.userSecret,
    durationMs ? context.now + durationMs : null,
  );
  await context.refreshUserAccess(boardName, target.userSecret);
}
