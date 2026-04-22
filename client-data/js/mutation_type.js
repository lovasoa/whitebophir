/** @typedef {import("../../types/app-runtime").MutationCode} MutationCode */

/** @type {{CREATE: MutationCode, UPDATE: MutationCode, DELETE: MutationCode, APPEND: MutationCode, BATCH: MutationCode, CLEAR: MutationCode, COPY: MutationCode}} */
export const MutationType = Object.freeze({
  CREATE: 1,
  UPDATE: 2,
  DELETE: 3,
  APPEND: 4,
  BATCH: 5,
  CLEAR: 6,
  COPY: 7,
});

/**
 * @param {unknown} type
 * @returns {MutationCode | undefined}
 */
export function getMutationTypeCode(type) {
  return typeof type === "number" &&
    type >= MutationType.CREATE &&
    type <= MutationType.COPY
    ? /** @type {MutationCode} */ (type)
    : undefined;
}
