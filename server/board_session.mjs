import { SerialTaskQueue } from "./serial_task_queue.mjs";
/** @typedef {import("../types/server-runtime.d.ts").MutationEnvelope} MutationEnvelope */
/** @typedef {import("../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {{mutation: NormalizedMessageData}} MutationEffect */
/** @typedef {{mutation: NormalizedMessageData, envelope: MutationEnvelope}} MutationFollowup */
/** @typedef {{ok: true} | {ok: false, reason: string}} BoardMutationResult */
/** @typedef {{ok: true, mutation?: NormalizedMessageData} | {ok: false, reason: string}} PreparedMutationResult */
/**
 * @typedef {{
 *   name: string,
 *   processMessage: (message: NormalizedMessageData) => BoardMutationResult,
 *   recordPersistentMutation: (message: NormalizedMessageData, acceptedAtMs?: number, clientMutationId?: string, socketId?: string) => MutationEnvelope,
 *   consumePendingRejectedMutationEffects?: () => MutationEffect[],
 *   consumePendingAcceptedMutationEffects?: () => MutationEffect[],
 *   preparePersistentMutation?: (message: NormalizedMessageData) => Promise<PreparedMutationResult> | PreparedMutationResult,
 * }} BoardSessionBoard
 */
/**
 * @typedef {{
 *   board: BoardSessionBoard,
 *   acceptPersistentMutation: (
 *     socketId: string,
 *     mutation: NormalizedMessageData,
 *     clientMutationId?: string,
 *     nowMs?: number,
 *   ) => Promise<
 *     | {ok: true, value: NormalizedMessageData, envelope: MutationEnvelope, followup?: MutationFollowup[]}
 *     | {ok: false, reason: string, followup?: MutationFollowup[]}
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
    async acceptPersistentMutation(
      socketId,
      mutation,
      clientMutationId,
      nowMs = Date.now(),
    ) {
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
          ).map((effect) => ({
            mutation: effect.mutation,
            envelope: board.recordPersistentMutation(
              effect.mutation,
              nowMs,
              undefined,
              socketId,
            ),
          }));
          return followup.length > 0 ? { ...result, followup } : result;
        }
        const envelope = board.recordPersistentMutation(
          acceptedMutation,
          nowMs,
          clientMutationId,
          socketId,
        );
        const followup = consumePendingMutationEffects(
          board,
          board.consumePendingAcceptedMutationEffects,
        ).map((effect) => ({
          mutation: effect.mutation,
          envelope: board.recordPersistentMutation(
            effect.mutation,
            nowMs,
            undefined,
            socketId,
          ),
        }));
        return {
          ok: true,
          value: acceptedMutation,
          envelope,
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
