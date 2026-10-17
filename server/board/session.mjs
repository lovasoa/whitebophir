import { SerialTaskQueue } from "./serial_task_queue.mjs";

/** @typedef {import("../../types/server-runtime.d.ts").MutationLogEntry} MutationLogEntry */
/** @typedef {import("../../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {import("./data.mjs").BoardMutationResult} BoardMutationResult */
/**
 * @typedef {{
 *   name: string,
 *   processMessage: (message: NormalizedMessageData) => BoardMutationResult,
 *   recordPersistentMutation: (message: NormalizedMessageData, acceptedAtMs?: number) => MutationLogEntry,
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
      return queue.runExclusive(() => {
        const result = board.processMessage(mutation);
        if (result.ok === false) {
          const followup = result.effects?.map((effect) =>
            board.recordPersistentMutation(effect, nowMs),
          );
          return {
            ok: false,
            reason: result.reason,
            ...(followup?.length ? { followup } : {}),
          };
        }
        const entry = board.recordPersistentMutation(mutation, nowMs);
        const followup = result.effects?.map((effect) =>
          board.recordPersistentMutation(effect, nowMs),
        );
        return {
          ok: true,
          value: mutation,
          entry,
          ...(followup?.length ? { followup } : {}),
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
