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
    dependencyItemIds: entry.dependencyItemIds.slice(),
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
    dependencyItemIds: normalizeStringArray(entry.dependencyItemIds),
    rollback: structuredClone(entry.rollback),
    message: structuredClone(entry.message),
  };
}

export function createOptimisticJournal() {
  /** @type {Map<string, any>} */
  const entries = new Map();
  /** @type {Map<string, string[]>} */
  const latestMutationIdsByItemId = new Map();
  /** @type {string[]} */
  let order = [];

  /**
   * @param {any} entry
   * @returns {void}
   */
  function addEntryToIndexes(entry) {
    entry.affectedIds.forEach((/** @type {string} */ itemId) => {
      const mutationIds = latestMutationIdsByItemId.get(itemId) || [];
      mutationIds.push(entry.clientMutationId);
      latestMutationIdsByItemId.set(itemId, mutationIds);
    });
  }

  /**
   * @param {any} entry
   * @returns {void}
   */
  function removeEntryFromIndexes(entry) {
    entry.affectedIds.forEach((/** @type {string} */ itemId) => {
      const mutationIds = latestMutationIdsByItemId.get(itemId);
      if (!mutationIds) return;
      const nextMutationIds = mutationIds.filter(
        (clientMutationId) => clientMutationId !== entry.clientMutationId,
      );
      if (nextMutationIds.length === 0) {
        latestMutationIdsByItemId.delete(itemId);
        return;
      }
      latestMutationIdsByItemId.set(itemId, nextMutationIds);
    });
  }

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
      const existing = entries.get(normalized.clientMutationId);
      if (existing) {
        removeEntryFromIndexes(existing);
      }
      entries.set(normalized.clientMutationId, normalized);
      order = order.filter((id) => id !== normalized.clientMutationId);
      order.push(normalized.clientMutationId);
      addEntryToIndexes(normalized);
      return cloneEntry(normalized);
    },
    /**
     * @param {string} clientMutationId
     * @returns {any[]}
     */
    promote(clientMutationId) {
      if (!entries.has(clientMutationId)) return [];
      const promoted = cloneEntry(entries.get(clientMutationId));
      removeEntryFromIndexes(entries.get(clientMutationId));
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
        const entry = entries.get(id);
        if (entry) removeEntryFromIndexes(entry);
        entries.delete(id);
      });
      order = order.filter((id) => !rejectedIds.has(id));
      return rejectedEntries;
    },
    /**
     * @param {string[]} invalidatedIds
     * @returns {any[]}
     */
    rejectByInvalidatedIds(invalidatedIds) {
      const invalidatedIdSet = new Set(normalizeStringArray(invalidatedIds));
      if (invalidatedIdSet.size === 0) return [];
      const rejectedIds = new Set(
        order.filter((id) => {
          const entry = entries.get(id);
          if (!entry) return false;
          return (
            entry.affectedIds.some((/** @type {string} */ affectedId) =>
              invalidatedIdSet.has(affectedId),
            ) ||
            entry.dependencyItemIds.some(
              (/** @type {string} */ dependencyItemId) =>
                invalidatedIdSet.has(dependencyItemId),
            )
          );
        }),
      );
      if (rejectedIds.size === 0) return [];
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
        const entry = entries.get(id);
        if (entry) removeEntryFromIndexes(entry);
        entries.delete(id);
      });
      order = order.filter((id) => !rejectedIds.has(id));
      return rejectedEntries;
    },
    /**
     * @param {string[]} itemIds
     * @returns {string[]}
     */
    dependencyMutationIdsForItemIds(itemIds) {
      return [
        ...new Set(
          normalizeStringArray(itemIds)
            .map((itemId) => latestMutationIdsByItemId.get(itemId)?.at(-1))
            .filter((clientMutationId) => typeof clientMutationId === "string"),
        ),
      ];
    },
    reset() {
      const pending = list();
      entries.clear();
      latestMutationIdsByItemId.clear();
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
