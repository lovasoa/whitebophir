import { SerialTaskQueue } from "./serial_task_queue.mjs";
/** @typedef {import("../types/server-runtime.d.ts").MutationLogEntry} MutationLogEntry */
/** @typedef {import("../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {{mutation: NormalizedMessageData}} MutationEffect */
/** @typedef {{ok: true} | {ok: false, reason: string}} BoardMutationResult */
/** @typedef {{ok: true, mutation?: NormalizedMessageData} | {ok: false, reason: string}} PreparedMutationResult */
/**
 * @typedef {{
 *   name: string,
 *   processMessage: (message: NormalizedMessageData) => BoardMutationResult,
 *   recordPersistentMutation: (message: NormalizedMessageData, acceptedAtMs?: number) => MutationLogEntry,
 *   consumePendingRejectedMutationEffects?: () => MutationEffect[],
 *   consumePendingAcceptedMutationEffects?: () => MutationEffect[],
 *   preparePersistentMutation?: (message: NormalizedMessageData) => Promise<PreparedMutationResult> | PreparedMutationResult,
 * }} BoardSessionBoard
 */
/**
 * @typedef {{
 *   board: BoardSessionBoard,
 *   acceptPersistentMutation: (
 *     mutation: NormalizedMessageData,
 *     nowMs?: number,
 *   ) => Promise<
 *     | {ok: true, value: NormalizedMessageData, entry: MutationLogEntry, followup?: MutationLogEntry[]}
 *     | {ok: false, reason: string, followup?: MutationLogEntry[]}
 *   >,
 * }} BoardSession
 */

/**
 * @param {BoardSessionBoard} board
 * @param {(() => MutationEffect[]) | undefined} consumeEffects
 * @returns {MutationEffect[]}
 */
function consumePendingMutationEffects(board, consumeEffects) {
  return typeof consumeEffects === "function" ? consumeEffects.call(board) : [];
}

/** @type {WeakMap<BoardSessionBoard, BoardSession>} */
const BOARD_SESSIONS = new WeakMap();

/**
 * @param {BoardSessionBoard} board
 * @returns {BoardSession}
 */
export function createBoardSession(board) {
  const queue = new SerialTaskQueue();
  return {
    board,
    async acceptPersistentMutation(mutation, nowMs = Date.now()) {
      return queue.runExclusive(async () => {
        consumePendingMutationEffects(
          board,
          board.consumePendingRejectedMutationEffects,
        );
        consumePendingMutationEffects(
          board,
          board.consumePendingAcceptedMutationEffects,
        );
        let acceptedMutation = mutation;
        if (typeof board.preparePersistentMutation === "function") {
          const prepared =
            await board.preparePersistentMutation(acceptedMutation);
          if (prepared.ok === false) {
            return prepared;
          }
          if (prepared.mutation) {
            acceptedMutation = prepared.mutation;
          }
        }
        const result = board.processMessage(acceptedMutation);
        if (result.ok === false) {
          const followup = consumePendingMutationEffects(
            board,
            board.consumePendingRejectedMutationEffects,
          ).map((effect) =>
            board.recordPersistentMutation(effect.mutation, nowMs),
          );
          return followup.length > 0 ? { ...result, followup } : result;
        }
        const entry = board.recordPersistentMutation(acceptedMutation, nowMs);
        const followup = consumePendingMutationEffects(
          board,
          board.consumePendingAcceptedMutationEffects,
        ).map((effect) =>
          board.recordPersistentMutation(effect.mutation, nowMs),
        );
        return {
          ok: true,
          value: acceptedMutation,
          entry,
          ...(followup.length > 0 ? { followup } : {}),
        };
      });
    },
  };
}

/**
 * @param {BoardSessionBoard} board
 * @returns {BoardSession}
 */
export function getBoardSession(board) {
  const existing = BOARD_SESSIONS.get(board);
  if (existing) return existing;
  const created = createBoardSession(board);
  BOARD_SESSIONS.set(board, created);
  return created;
}
