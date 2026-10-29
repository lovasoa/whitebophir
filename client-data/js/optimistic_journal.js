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
  /** @type {Map<string, string>} */
  const latestMutationIdByItemId = new Map();

  /**
   * @param {OptimisticJournalEntry} entry
   * @returns {void}
   */
  function addEntryToIndexes(entry) {
    for (const itemId of entry.affectedIds) {
      latestMutationIdByItemId.set(itemId, entry.clientMutationId);
    }
  }

  /** @param {OptimisticJournalEntry} entry */
  function removeEntry(entry) {
    entries.delete(entry.clientMutationId);
    const orphanedIds = new Set();
    for (const itemId of entry.affectedIds) {
      if (latestMutationIdByItemId.get(itemId) === entry.clientMutationId) {
        latestMutationIdByItemId.delete(itemId);
        orphanedIds.add(itemId);
      }
    }
    if (orphanedIds.size === 0) return entry;
    for (const pending of entries.values()) {
      for (const itemId of pending.affectedIds) {
        if (orphanedIds.has(itemId)) {
          latestMutationIdByItemId.set(itemId, pending.clientMutationId);
        }
      }
    }
    return entry;
  }

  /**
   * @param {Set<string>} rejectedIds
   * @returns {void}
   */
  function expandRejectedIds(rejectedIds) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of entries.values()) {
        const id = entry.clientMutationId;
        if (rejectedIds.has(id)) continue;
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
    /** @type {OptimisticJournalEntry[]} */
    const removedEntries = [];
    for (const entry of entries.values()) {
      if (entryIds.has(entry.clientMutationId)) {
        entries.delete(entry.clientMutationId);
        removedEntries.push(entry);
      }
    }
    if (removedEntries.length > 0) {
      latestMutationIdByItemId.clear();
      for (const entry of entries.values()) addEntryToIndexes(entry);
    }
    return removedEntries;
  }

  /** @returns {OptimisticJournalEntry[]} */
  function list() {
    return [...entries.values()];
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
      if (existing) removeEntry(existing);
      entries.set(nextEntry.clientMutationId, nextEntry);
      addEntryToIndexes(nextEntry);
      return nextEntry;
    },
    /**
     * @param {string} clientMutationId
     * @returns {OptimisticJournalEntry[]}
     */
    promote(clientMutationId) {
      const entry = entries.get(clientMutationId);
      return entry ? [removeEntry(entry)] : [];
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
      for (const entry of entries.values()) {
        const id = entry.clientMutationId;
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
        const clientMutationId = latestMutationIdByItemId.get(itemId);
        if (clientMutationId !== undefined) {
          dependencyMutationIds.add(clientMutationId);
        }
      }
      return dependencyMutationIds;
    },
    reset() {
      const pending = list();
      entries.clear();
      latestMutationIdByItemId.clear();
      return pending;
    },
    list,
    size() {
      return entries.size;
    },
  };
}
