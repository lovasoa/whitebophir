/** @typedef {import("../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */

/**
 * @returns {{runExclusive: <T>(task: () => Promise<T> | T) => Promise<T>}}
 */
function createSerialQueue() {
  let pending = Promise.resolve();
  return {
    runExclusive(task) {
      const run = pending.then(task, task);
      pending = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

/**
 * @param {{
 *   consumePendingRejectedMutationEffects?: () => Array<{mutation: NormalizedMessageData, revision: number}>,
 * }} board
 * @returns {Array<{mutation: NormalizedMessageData, revision: number}>}
 */
function consumePendingRejectedMutationEffects(board) {
  return typeof board.consumePendingRejectedMutationEffects === "function"
    ? board.consumePendingRejectedMutationEffects()
    : [];
}

/** @type {WeakMap<object, ReturnType<typeof createBoardSession>>} */
const BOARD_SESSIONS = new WeakMap();

/**
 * @param {{
 *   name: string,
 *   processMessage: (message: NormalizedMessageData) => {ok: true, revision?: number} | {ok: false, reason: string},
 *   recordPersistentMutation: (message: NormalizedMessageData, acceptedAtMs?: number, clientMutationId?: string) => any,
 *   consumePendingRejectedMutationEffects?: () => Array<{mutation: NormalizedMessageData, revision: number}>,
 *   preparePersistentMutation?: (message: NormalizedMessageData) => Promise<{ok: true, mutation?: NormalizedMessageData} | {ok: false, reason: string}> | {ok: true, mutation?: NormalizedMessageData} | {ok: false, reason: string},
 * }} board
 * @returns {{
 *   board: object,
 *   acceptPersistentMutation: (socketId: string, mutation: NormalizedMessageData, clientMutationId?: string, nowMs?: number) => Promise<{ok: true, value: NormalizedMessageData, revision: number, envelope: any} | {ok: false, reason: string, followup?: Array<{mutation: NormalizedMessageData, revision: number, envelope: any}>}>
 * }}
 */
export function createBoardSession(board) {
  const queue = createSerialQueue();
  return {
    board,
    async acceptPersistentMutation(
      socketId,
      mutation,
      clientMutationId,
      nowMs = Date.now(),
    ) {
      return queue.runExclusive(async () => {
        void socketId;
        consumePendingRejectedMutationEffects(board);
        let acceptedMutation = structuredClone(mutation);
        if (typeof board.preparePersistentMutation === "function") {
          const prepared = await board.preparePersistentMutation(
            structuredClone(acceptedMutation),
          );
          if (prepared.ok === false) {
            return prepared;
          }
          if (prepared.mutation) {
            acceptedMutation = prepared.mutation;
          }
        }
        const result = board.processMessage(structuredClone(acceptedMutation));
        if (result.ok === false) {
          const followup = consumePendingRejectedMutationEffects(board).map(
            (effect) => ({
              mutation: effect.mutation,
              revision: effect.revision,
              envelope: board.recordPersistentMutation(
                effect.mutation,
                nowMs,
                undefined,
              ),
            }),
          );
          return followup.length > 0 ? { ...result, followup } : result;
        }
        return {
          ok: true,
          value: acceptedMutation,
          revision: result.revision || 0,
          envelope: board.recordPersistentMutation(
            acceptedMutation,
            nowMs,
            clientMutationId,
          ),
        };
      });
    },
  };
}

/**
 * @param {{
 *   name: string,
 *   processMessage: (message: NormalizedMessageData) => {ok: true, revision?: number} | {ok: false, reason: string},
 *   recordPersistentMutation: (message: NormalizedMessageData, acceptedAtMs?: number, clientMutationId?: string) => any,
 *   consumePendingRejectedMutationEffects?: () => Array<{mutation: NormalizedMessageData, revision: number}>,
 *   preparePersistentMutation?: (message: NormalizedMessageData) => Promise<{ok: true, mutation?: NormalizedMessageData} | {ok: false, reason: string}> | {ok: true, mutation?: NormalizedMessageData} | {ok: false, reason: string},
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

export default {
  createBoardSession,
  getBoardSession,
};
