/** @typedef {import("../../types/app-runtime").OptimisticJournalEntry} OptimisticJournalEntry */
/** @typedef {import("../../types/app-runtime").OptimisticJournalEntryInput} OptimisticJournalEntryInput */

/**
 * @param {OptimisticJournalEntryInput} entry
 * @returns {OptimisticJournalEntry}
 */
function createEntry(entry) {
  return {
    clientMutationId: entry.message.clientMutationId,
    affectedIds: new Set(entry.affectedIds),
    dependsOn: new Set(entry.dependsOn),
    dependencyItemIds: new Set(entry.dependencyItemIds ?? []),
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
    for (const itemId of entry.affectedIds) {
      const mutationIds = latestMutationIdsByItemId.get(itemId) || [];
      mutationIds.push(entry.clientMutationId);
      latestMutationIdsByItemId.set(itemId, mutationIds);
    }
  }

  /**
   * @param {OptimisticJournalEntry} entry
   * @returns {void}
   */
  function removeEntryFromIndexes(entry) {
    for (const itemId of entry.affectedIds) {
      const mutationIds = latestMutationIdsByItemId.get(itemId);
      if (!mutationIds) continue;
      const nextMutationIds = mutationIds.filter(
        (clientMutationId) => clientMutationId !== entry.clientMutationId,
      );
      if (nextMutationIds.length === 0) {
        latestMutationIdsByItemId.delete(itemId);
        continue;
      }
      latestMutationIdsByItemId.set(itemId, nextMutationIds);
    }
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
        for (const dependencyId of entry.dependsOn) {
          if (rejectedIds.has(dependencyId)) {
            rejectedIds.add(id);
            changed = true;
            break;
          }
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
     * @param {readonly string[]} invalidatedIds
     * @returns {OptimisticJournalEntry[]}
     */
    rejectByInvalidatedIds(invalidatedIds) {
      const invalidatedIdSet = new Set(invalidatedIds);
      if (invalidatedIdSet.size === 0) return [];
      const rejectedIds = new Set();
      for (const id of order) {
        const entry = entries.get(id);
        if (!entry) continue;
        for (const affectedId of entry.affectedIds) {
          if (invalidatedIdSet.has(affectedId)) {
            rejectedIds.add(id);
            break;
          }
        }
        if (rejectedIds.has(id)) continue;
        for (const dependencyItemId of entry.dependencyItemIds) {
          if (invalidatedIdSet.has(dependencyItemId)) {
            rejectedIds.add(id);
            break;
          }
        }
      }
      expandRejectedIds(rejectedIds);
      return removeEntries(rejectedIds);
    },
    /**
     * @param {ReadonlySet<string>} itemIds
     * @returns {Set<string>}
     */
    dependencyMutationIdsForItemIds(itemIds) {
      const dependencyMutationIds = new Set();
      for (const itemId of itemIds) {
        const mutationIds = latestMutationIdsByItemId.get(itemId);
        const clientMutationId =
          mutationIds === undefined
            ? undefined
            : mutationIds[mutationIds.length - 1];
        if (clientMutationId !== undefined) {
          dependencyMutationIds.add(clientMutationId);
        }
      }
      return dependencyMutationIds;
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
