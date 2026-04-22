/** @type {{CREATE: number, UPDATE: number, DELETE: number, APPEND: number, BATCH: number, CLEAR: number, COPY: number}} */
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
 * @returns {number | undefined}
 */
export function getMutationTypeCode(type) {
  return typeof type === "number" &&
    type >= MutationType.CREATE &&
    type <= MutationType.COPY
    ? type
    : undefined;
}
