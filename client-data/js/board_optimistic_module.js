import { TOOL_ID_BY_CODE } from "../tools/tool-order.js";
import { optimisticPrunePlanForAuthoritativeMessage } from "./authoritative_mutation_effects.js";
import { getMutationType, MutationType } from "./message_tool_metadata.js";
import { createOptimisticJournal } from "./optimistic_journal.js";
import {
  collectOptimisticAffectedIds,
  collectOptimisticDependencyIds,
} from "./optimistic_mutation.js";

/** @import { AppToolsState, BoardMessage, ClientTrackedMessage, LiveBoardMessage, OptimisticJournalEntry, OptimisticRollback } from "../../types/app-runtime" */

/** @param {AppToolsState} Tools */
function getAttachedBoardDom(Tools) {
  return Tools.dom.status === "attached" ? Tools.dom : null;
}

export class OptimisticModule {
  /** @param {() => AppToolsState} getTools */
  constructor(getTools) {
    this.getTools = getTools;
    this.journal = createOptimisticJournal();
  }

  /**
   * @param {LiveBoardMessage} message
   * @returns {OptimisticRollback}
   */
  captureRollback(message) {
    const Tools = this.getTools();
    const dom = getAttachedBoardDom(Tools);
    if (getMutationType(message) === MutationType.CLEAR) {
      return {
        kind: "drawing-area",
        markup: dom?.drawingArea.innerHTML || "",
      };
    }
    return {
      kind: "items",
      snapshots: [...collectOptimisticAffectedIds(message)].map((itemId) => {
        if (!dom) {
          return {
            id: itemId,
            outerHTML: null,
            nextSiblingId: null,
          };
        }
        const current = dom.svg.getElementById(itemId);
        return {
          id: itemId,
          outerHTML: current ? current.outerHTML : null,
          nextSiblingId:
            current && current.nextElementSibling
              ? current.nextElementSibling.id || null
              : null,
        };
      }),
    };
  }

  /** @param {LiveBoardMessage} message */
  collectDependencyMutationIds(message) {
    return this.journal.dependencyMutationIdsForItemIds(
      collectOptimisticDependencyIds(message),
    );
  }

  /**
   * @param {ClientTrackedMessage} message
   * @param {OptimisticRollback} rollback
   */
  trackMutation(message, rollback) {
    this.journal.append({
      affectedIds: collectOptimisticAffectedIds(message),
      dependsOn: this.collectDependencyMutationIds(message),
      dependencyItemIds: collectOptimisticDependencyIds(message),
      rollback,
      message,
    });
  }

  /** @param {OptimisticJournalEntry[]} rejected */
  applyRejectedEntries(rejected) {
    if (rejected.length === 0) return;
    rejected
      .slice()
      .reverse()
      .forEach((entry) => {
        this.restoreRollback(entry.rollback);
      });
  }

  /** @param {OptimisticRollback} rollback */
  restoreRollback(rollback) {
    const Tools = this.getTools();
    const dom = getAttachedBoardDom(Tools);
    if (!dom) return;
    if (rollback.kind === "drawing-area") {
      dom.drawingArea.innerHTML = rollback.markup;
      return;
    }
    rollback.snapshots.forEach((snapshot) => {
      const current = dom.svg.getElementById(snapshot.id);
      if (snapshot.outerHTML === null) {
        current?.remove();
        return;
      }
      if (current) {
        current.outerHTML = snapshot.outerHTML;
        return;
      }
      const nextSibling = snapshot.nextSiblingId
        ? dom.svg.getElementById(snapshot.nextSiblingId)
        : null;
      if (nextSibling?.parentNode === dom.drawingArea) {
        nextSibling.insertAdjacentHTML("beforebegin", snapshot.outerHTML);
      } else {
        dom.drawingArea.insertAdjacentHTML("beforeend", snapshot.outerHTML);
      }
    });
  }

  /** @param {string} clientMutationId */
  promoteMutation(clientMutationId) {
    if (this.journal.promote(clientMutationId).length === 0) return;
  }

  /**
   * @param {OptimisticJournalEntry[]} rejected
   * @param {string | undefined} reason
   * @returns {void}
   */
  notifyRejectedTools(rejected, reason) {
    const Tools = this.getTools();
    if (rejected.length === 0) return;
    rejected.forEach((entry) => {
      const toolName = TOOL_ID_BY_CODE[entry.message.tool];
      const tool = Tools.toolRegistry.mounted[toolName];
      tool?.onMutationRejected?.(entry.message, reason);
    });
  }

  /**
   * @param {string} clientMutationId
   * @param {string | undefined} reason
   */
  rejectMutation(clientMutationId, reason) {
    const rejected = this.journal.reject(clientMutationId);
    this.applyRejectedEntries(rejected);
    this.notifyRejectedTools(rejected, reason);
  }

  /** @param {BoardMessage} message */
  pruneForAuthoritativeMessage(message) {
    const prunePlan = optimisticPrunePlanForAuthoritativeMessage(message);
    if (prunePlan.reset) {
      this.applyRejectedEntries(this.journal.reset());
      return;
    }
    if (prunePlan.invalidatedIds.length === 0) {
      return;
    }
    this.applyRejectedEntries(
      this.journal.rejectByInvalidatedIds(prunePlan.invalidatedIds),
    );
  }
}
