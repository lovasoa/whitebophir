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
  if (typeof type === "number") {
    return type >= MutationType.CREATE && type <= MutationType.COPY
      ? type
      : undefined;
  }
  switch (type) {
    case "update":
      return MutationType.UPDATE;
    case "delete":
      return MutationType.DELETE;
    case "clear":
      return MutationType.CLEAR;
    case "copy":
      return MutationType.COPY;
    case "child":
      return MutationType.APPEND;
  }
  return undefined;
}
