/** @typedef {import("../../types/app-runtime").OptimisticJournalEntry} OptimisticJournalEntry */
/** @typedef {import("../../types/app-runtime").OptimisticJournalEntryInput} OptimisticJournalEntryInput */

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item))];
}

/**
 * @param {OptimisticJournalEntryInput} entry
 * @returns {OptimisticJournalEntry}
 */
function createEntry(entry) {
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
    rollback: entry.rollback,
    message: entry.message,
  };
}

export function createOptimisticJournal() {
  /** @type {Map<string, OptimisticJournalEntry>} */
  const entries = new Map();
  /** @type {Map<string, string[]>} */
  const latestMutationIdsByItemId = new Map();
  /** @type {string[]} */
  let order = [];

  /**
   * @param {OptimisticJournalEntry} entry
   * @returns {void}
   */
  function addEntryToIndexes(entry) {
    entry.affectedIds.forEach((itemId) => {
      const mutationIds = latestMutationIdsByItemId.get(itemId) || [];
      mutationIds.push(entry.clientMutationId);
      latestMutationIdsByItemId.set(itemId, mutationIds);
    });
  }

  /**
   * @param {OptimisticJournalEntry} entry
   * @returns {void}
   */
  function removeEntryFromIndexes(entry) {
    entry.affectedIds.forEach((itemId) => {
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

  /**
   * @param {Set<string>} rejectedIds
   * @returns {void}
   */
  function expandRejectedIds(rejectedIds) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of order) {
        const entry = entries.get(id);
        if (!entry || rejectedIds.has(id)) continue;
        if (
          entry.dependsOn.some((dependencyId) => rejectedIds.has(dependencyId))
        ) {
          rejectedIds.add(id);
          changed = true;
        }
      }
    }
  }

  /**
   * @param {Set<string>} entryIds
   * @returns {OptimisticJournalEntry[]}
   */
  function removeEntries(entryIds) {
    if (entryIds.size === 0) return [];
    /** @type {OptimisticJournalEntry[]} */
    const removedEntries = [];
    order = order.filter((id) => {
      if (!entryIds.has(id)) return true;
      const entry = entries.get(id);
      if (entry) {
        removedEntries.push(entry);
        removeEntryFromIndexes(entry);
      }
      entries.delete(id);
      return false;
    });
    return removedEntries;
  }

  /** @returns {OptimisticJournalEntry[]} */
  function list() {
    return order.flatMap((clientMutationId) => {
      const entry = entries.get(clientMutationId);
      return entry ? [entry] : [];
    });
  }

  return {
    /**
     * Takes ownership of entry.message and entry.rollback. Callers must not
     * mutate them after append.
     * @param {OptimisticJournalEntryInput} entry
     * @returns {OptimisticJournalEntry}
     */
    append(entry) {
      const nextEntry = createEntry(entry);
      const existing = entries.get(nextEntry.clientMutationId);
      if (existing) removeEntryFromIndexes(existing);
      entries.set(nextEntry.clientMutationId, nextEntry);
      order = order.filter((id) => id !== nextEntry.clientMutationId);
      order.push(nextEntry.clientMutationId);
      addEntryToIndexes(nextEntry);
      return nextEntry;
    },
    /**
     * @param {string} clientMutationId
     * @returns {OptimisticJournalEntry[]}
     */
    promote(clientMutationId) {
      return entries.has(clientMutationId)
        ? removeEntries(new Set([clientMutationId]))
        : [];
    },
    /**
     * @param {string} clientMutationId
     * @returns {OptimisticJournalEntry[]}
     */
    reject(clientMutationId) {
      if (!entries.has(clientMutationId)) return [];
      const rejectedIds = new Set([clientMutationId]);
      expandRejectedIds(rejectedIds);
      return removeEntries(rejectedIds);
    },
    /**
     * @param {string[]} invalidatedIds
     * @returns {OptimisticJournalEntry[]}
     */
    rejectByInvalidatedIds(invalidatedIds) {
      const invalidatedIdSet = new Set(normalizeStringArray(invalidatedIds));
      if (invalidatedIdSet.size === 0) return [];
      const rejectedIds = new Set(
        order.filter((id) => {
          const entry = entries.get(id);
          return !!(
            entry &&
            (entry.affectedIds.some((affectedId) =>
              invalidatedIdSet.has(affectedId),
            ) ||
              entry.dependencyItemIds.some((dependencyItemId) =>
                invalidatedIdSet.has(dependencyItemId),
              ))
          );
        }),
      );
      expandRejectedIds(rejectedIds);
      return removeEntries(rejectedIds);
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
