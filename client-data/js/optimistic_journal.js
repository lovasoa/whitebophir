/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item))];
}

/**
 * @param {any} entry
 * @returns {any}
 */
function cloneEntry(entry) {
  return {
    clientMutationId: entry.clientMutationId,
    affectedIds: entry.affectedIds.slice(),
    dependsOn: entry.dependsOn.slice(),
    rollback: structuredClone(entry.rollback),
    message: structuredClone(entry.message),
  };
}

/**
 * @param {any} entry
 * @returns {any}
 */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("Optimistic journal entry must be an object");
  }
  if (
    typeof entry.clientMutationId !== "string" ||
    entry.clientMutationId.length === 0
  ) {
    throw new Error("Optimistic journal entries require clientMutationId");
  }
  return {
    clientMutationId: entry.clientMutationId,
    affectedIds: normalizeStringArray(entry.affectedIds),
    dependsOn: normalizeStringArray(entry.dependsOn),
    rollback: structuredClone(entry.rollback),
    message: structuredClone(entry.message),
  };
}

export function createOptimisticJournal() {
  /** @type {Map<string, any>} */
  const entries = new Map();
  /** @type {string[]} */
  let order = [];

  function list() {
    return order.map((clientMutationId) =>
      cloneEntry(entries.get(clientMutationId)),
    );
  }

  return {
    /**
     * @param {any} entry
     * @returns {any}
     */
    append(entry) {
      const normalized = normalizeEntry(entry);
      entries.set(normalized.clientMutationId, normalized);
      order = order.filter((id) => id !== normalized.clientMutationId);
      order.push(normalized.clientMutationId);
      return cloneEntry(normalized);
    },
    /**
     * @param {string} clientMutationId
     * @returns {any[]}
     */
    promote(clientMutationId) {
      if (!entries.has(clientMutationId)) return [];
      const promoted = cloneEntry(entries.get(clientMutationId));
      entries.delete(clientMutationId);
      order = order.filter((id) => id !== clientMutationId);
      return [promoted];
    },
    /**
     * @param {string} clientMutationId
     * @returns {any[]}
     */
    reject(clientMutationId) {
      if (!entries.has(clientMutationId)) return [];
      const rejectedIds = new Set([clientMutationId]);
      let changed = true;
      while (changed) {
        changed = false;
        order.forEach((id) => {
          const entry = entries.get(id);
          if (!entry || rejectedIds.has(id)) return;
          if (
            entry.dependsOn.some((/** @type {string} */ dependencyId) =>
              rejectedIds.has(dependencyId),
            )
          ) {
            rejectedIds.add(id);
            changed = true;
          }
        });
      }
      const rejectedEntries = order
        .filter((id) => rejectedIds.has(id))
        .map((id) => cloneEntry(entries.get(id)));
      rejectedIds.forEach((id) => {
        entries.delete(id);
      });
      order = order.filter((id) => !rejectedIds.has(id));
      return rejectedEntries;
    },
    reset() {
      const pending = list();
      entries.clear();
      order = [];
      return pending;
    },
    list,
    size() {
      return order.length;
    },
  };
}

export default {
  createOptimisticJournal,
};
