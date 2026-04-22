import { SerialTaskQueue } from "./serial_task_queue.mjs";
/** @typedef {import("../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */

/**
 * @param {object} board
 * @param {(() => Array<{mutation: NormalizedMessageData}>) | undefined} consumeEffects
 * @returns {Array<{mutation: NormalizedMessageData}>}
 */
function consumePendingMutationEffects(board, consumeEffects) {
  return typeof consumeEffects === "function" ? consumeEffects.call(board) : [];
}

/** @type {WeakMap<object, ReturnType<typeof createBoardSession>>} */
const BOARD_SESSIONS = new WeakMap();

/**
 * @param {{
 *   name: string,
 *   processMessage: (message: NormalizedMessageData) => {ok: true} | {ok: false, reason: string},
 *   recordPersistentMutation: (message: NormalizedMessageData, acceptedAtMs?: number, clientMutationId?: string, socketId?: string) => any,
 *   consumePendingRejectedMutationEffects?: () => Array<{mutation: NormalizedMessageData}>,
 *   consumePendingAcceptedMutationEffects?: () => Array<{mutation: NormalizedMessageData}>,
 *   preparePersistentMutation?: (message: NormalizedMessageData) => Promise<{ok: true, mutation?: any} | {ok: false, reason: string}> | {ok: true, mutation?: any} | {ok: false, reason: string},
 * }} board
 * @returns {{
 *   board: object,
 *   acceptPersistentMutation: (socketId: string, mutation: NormalizedMessageData, clientMutationId?: string, nowMs?: number) => Promise<{ok: true, value: NormalizedMessageData, envelope: any, followup?: Array<{mutation: NormalizedMessageData, envelope: any}>} | {ok: false, reason: string, followup?: Array<{mutation: NormalizedMessageData, envelope: any}>}>
 * }}
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
 * @param {{
 *   name: string,
 *   processMessage: (message: NormalizedMessageData) => {ok: true} | {ok: false, reason: string},
 *   recordPersistentMutation: (message: NormalizedMessageData, acceptedAtMs?: number, clientMutationId?: string, socketId?: string) => any,
 *   consumePendingRejectedMutationEffects?: () => Array<{mutation: NormalizedMessageData}>,
 *   consumePendingAcceptedMutationEffects?: () => Array<{mutation: NormalizedMessageData}>,
 *   preparePersistentMutation?: (message: NormalizedMessageData) => Promise<{ok: true, mutation?: any} | {ok: false, reason: string}> | {ok: true, mutation?: any} | {ok: false, reason: string},
 * }} board
 * @returns {ReturnType<typeof createBoardSession>}
 */
export function getBoardSession(board) {
  const existing = BOARD_SESSIONS.get(board);
  if (existing) return existing;
  const created = createBoardSession(board);
  BOARD_SESSIONS.set(board, created);
  return created;
}
