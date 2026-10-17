/**
 *                  WHITEBOPHIR SERVER
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013-2014  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 * @module boardData
 */

import { boardSvgPath } from "../persistence/svg_board_paths.mjs";
import {
  authoritativeItemCount,
  getCanonicalItem,
  rebuildLiveItemCount,
  upsertCanonicalItem,
} from "./canonical_index.mjs";
import {
  canonicalItemFromItem,
  publicItemFromCanonicalItem,
} from "./canonical_items.mjs";
import {
  dirtyAgeMs as boardDirtyAgeMs,
  hasDirtyItems as boardHasDirtyItems,
  clearSaveTimeout as clearBoardSaveTimeout,
  computeScheduledSaveDelayMs,
  delaySave as delayBoardSave,
  disposeBoard,
  finalizePersistedItems as finalizeBoardPersistedItems,
  loadBoardData,
  saveBoard,
  scheduleDirtySave as scheduleBoardDirtySave,
  scheduleSaveTimeout as scheduleBoardSaveTimeout,
  trimPersistedMutationLog as trimBoardPersistedMutationLog,
  unsafeSaveBoard,
} from "./data_persistence.mjs";
import {
  processMessage as processBoardMessage,
  processMessageBatch as processBoardMessageBatch,
} from "./message_processing.mjs";
import { createMutationLog } from "./mutation_log.mjs";
import {
  createDefaultSvgExtent,
  extendSvgExtentForItem,
} from "./svg_extent.mjs";

/** @returns {BoardMetadata} */
function defaultBoardMetadata() {
  return {
    readonly: false,
  };
}

let boardInstanceSequence = 0;
/** @typedef {{minX: number, minY: number, maxX: number, maxY: number}} Bounds */
/** @typedef {{readonly: boolean}} BoardMetadata */
/** @typedef {{ok: false, reason: string}} ValidationFailure */
/** @typedef {{ok: true}} ValidationSuccess */
/** @typedef {(ValidationSuccess | ValidationFailure) & {effects?: NormalizedMessageData[]}} BoardMutationResult */
/** @typedef {import("../../types/app-runtime.d.ts").BoardMessage} BoardMessage */
/** @typedef {import("../../types/app-runtime.d.ts").ToolOwnedChildMessage} ToolOwnedChildMessage */
/** @typedef {import("../../types/app-runtime.d.ts").Transform} Transform */
/** @typedef {import("../../types/server-runtime.d.ts").MutationLogEntry} MutationLogEntry */
/** @typedef {import("../../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {{x: number, y: number}} ChildPoint */
/** @typedef {import("./svg_extent.mjs").SvgExtent} SvgExtent */
/** @typedef {{kind: "inline"} | {kind: "text", modifiedText?: string} | {kind: "children", persistedChildCount: number, appendedChildren: ChildPoint[]}} CanonicalPayload */
/** @typedef {{actualFileSeq?: number, durationMs?: number, saveTargetSeq?: number}} StaleSaveDetails */
/** @typedef {(details: StaleSaveDetails) => void | Promise<void>} StaleSaveHandler */
/**
 * @typedef {{
 *   id: string,
 *   tool: string,
 *   paintOrder: number,
 *   deleted: boolean,
 *   attrs: {[key: string]: unknown},
 *   bounds: Bounds | null,
 *   transform?: Transform,
 *   dirty: boolean,
 *   time?: number,
 *   payload: CanonicalPayload,
 *   textLength?: number,
 *   copySource?: {sourceId: string},
 * }} CanonicalBoardItem
 */
/**
 * @typedef {Pick<
 *   typeof import("../configuration.mjs"),
 *   | "HISTORY_DIR"
 *   | "MAX_BOARD_SIZE"
 *   | "MAX_CHILDREN"
 *   | "MAX_ITEM_COUNT"
 *   | "MAX_SAVE_DELAY"
 *   | "SAVE_INTERVAL"
 *   | "SEQ_REPLAY_RETENTION_MS"
 * >} BoardConfig
 */

/**
 * Represents a board.
 * @typedef {{[object_id:string]: any}} BoardElem
 */
class BoardData {
  /**
   * @param {string} name
   * @param {BoardConfig} config
   */
  constructor(name, config) {
    this.name = name;
    /** @type {BoardConfig} */
    this.config = config;
    this.instanceId = ++boardInstanceSequence;
    this.loadSource = "empty";
    this.metadata = defaultBoardMetadata();
    this.historyDir = config.HISTORY_DIR;
    this.maxBoardSize = config.MAX_BOARD_SIZE;
    this.maxChildren = config.MAX_CHILDREN;
    this.maxItemCount = config.MAX_ITEM_COUNT;
    this.file = boardSvgPath(name, this.historyDir);
    /** @type {Set<string>} */
    this.persistedItemIds = new Set();
    /** @type {number | null} */
    this.dirtyFromMs = null;
    /** @type {number | null} */
    this.lastWriteAtMs = null;
    /** @type {number | null} */
    this.dirtyDuringSaveFromMs = null;
    /** @type {number | null} */
    this.saveStartedAtMs = null;
    /** @type {number | null} */
    this.saveTargetSeq = null;
    this.saveInProgress = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.saveTimeoutId = undefined;
    this.users = new Set();
    this.mutationLog = createMutationLog(0);
    /** @type {Map<string, CanonicalBoardItem>} */
    this.itemsById = new Map();
    /** @type {string[]} */
    this.paintOrder = [];
    this.nextPaintOrder = 0;
    this.liveItemCount = 0;
    this.trimPaintOrderIndex = 0;
    /** @type {SvgExtent} */
    this.svgExtent = createDefaultSvgExtent();
    this.disposed = false;
    /** @type {StaleSaveHandler | undefined} */
    this.onStaleSave = undefined;
  }

  get hasPersistedBaseline() {
    return this.persistedItemIds.size > 0;
  }

  get board() {
    return Object.fromEntries(
      this.paintOrder
        .map((id) => [id, this.get(id)])
        .filter((entry) => entry[1] !== undefined),
    );
  }

  set board(value) {
    this.itemsById = new Map();
    this.paintOrder = [];
    this.nextPaintOrder = 0;
    this.persistedItemIds = new Set();
    this.dirtyFromMs = null;
    this.lastWriteAtMs = null;
    this.dirtyDuringSaveFromMs = null;
    this.saveStartedAtMs = null;
    this.saveTargetSeq = null;
    this.liveItemCount = 0;
    this.trimPaintOrderIndex = 0;
    this.svgExtent = createDefaultSvgExtent();
    let paintOrder = 0;
    for (const [id, item] of Object.entries(value || {})) {
      const canonical = canonicalItemFromItem({ ...item, id }, paintOrder, {
        persisted: false,
      });
      if (!canonical) continue;
      this.upsertItem(canonical);
      paintOrder += 1;
    }
  }

  isReadOnly() {
    return this.metadata.readonly === true;
  }

  /**
   * @returns {number}
   */
  getSeq() {
    return this.mutationLog.latestSeq();
  }

  /**
   * @returns {number}
   */
  getPersistedSeq() {
    return this.mutationLog.persistedSeq();
  }

  /**
   * @returns {number}
   */
  minReplayableSeq() {
    return this.mutationLog.minReplayableSeq();
  }

  /**
   * @param {number} fromExclusiveSeq
   * @returns {MutationLogEntry[]}
   */
  readMutationsAfter(fromExclusiveSeq) {
    return this.mutationLog.readFrom(fromExclusiveSeq);
  }

  /**
   * @param {NormalizedMessageData} mutation
   * @param {number} [acceptedAtMs]
   * @returns {MutationLogEntry}
   */
  recordPersistentMutation(mutation, acceptedAtMs = Date.now()) {
    return this.mutationLog.append({
      acceptedAtMs,
      mutation,
    });
  }

  /**
   * @param {number} persistedSeq
   * @returns {void}
   */
  markPersistedSeq(persistedSeq) {
    this.mutationLog.markPersisted(persistedSeq);
  }

  /**
   * @param {number} seqInclusiveFloor
   * @returns {void}
   */
  trimMutationLogBefore(seqInclusiveFloor) {
    this.mutationLog.trimBefore(seqInclusiveFloor);
  }

  /**
   * @param {number} [nowMs]
   * @returns {void}
   */
  trimPersistedMutationLog(nowMs = Date.now()) {
    trimBoardPersistedMutationLog(this, nowMs);
  }

  /**
   * @returns {number}
   */
  authoritativeItemCount() {
    return authoritativeItemCount(this);
  }

  /**
   * @param {CanonicalBoardItem} item
   * @returns {void}
   */
  upsertItem(item) {
    upsertCanonicalItem(this, item);
    extendSvgExtentForItem(this.svgExtent, item);
  }

  /** Process a batch of messages
   * @param {(BoardMessage | ToolOwnedChildMessage)[]} children array of messages to be delegated to the other methods
   * @param {BoardMessage} [parentMessage]
   * @returns {BoardMutationResult}
   */
  processMessageBatch(children, parentMessage) {
    return processBoardMessageBatch(this, children, parentMessage);
  }

  /** Process a single message
   * @param {BoardMessage} message instruction to apply to the board
   * @returns {BoardMutationResult}
   */
  processMessage(message) {
    return processBoardMessage(this, message);
  }

  /** Reads data from the board
   * @param {string} id - Identifier of the element to get.
   * @returns {BoardElem | undefined} The element with the given id, or undefined if no element has this id
   */
  get(id) {
    return publicItemFromCanonicalItem(getCanonicalItem(this, id));
  }

  clearSaveTimeout() {
    clearBoardSaveTimeout(this);
  }

  /**
   * @param {number} [nowMs]
   * @returns {number | null}
   */
  dirtyAgeMs(nowMs = Date.now()) {
    return boardDirtyAgeMs(this, nowMs);
  }

  /** Delays the triggering of auto-save by SAVE_INTERVAL milliseconds. */
  delaySave() {
    delayBoardSave(this);
  }

  /**
   * @param {number} [nowMs]
   * @returns {void}
   */
  scheduleDirtySave(nowMs = Date.now()) {
    scheduleBoardDirtySave(this, nowMs);
  }

  /**
   * @param {number} delayMs
   * @returns {void}
   */
  scheduleSaveTimeout(delayMs) {
    scheduleBoardSaveTimeout(this, delayMs);
  }

  dispose() {
    disposeBoard(this);
  }

  hasDirtyItems() {
    return boardHasDirtyItems(this);
  }

  finalizePersistedItems(
    persistedSnapshot = this.itemsById,
    persistedIds = new Set(persistedSnapshot.keys()),
  ) {
    finalizeBoardPersistedItems(this, persistedSnapshot, persistedIds);
  }

  /** Saves the data in the board to a file. */
  async save() {
    return saveBoard(this);
  }

  /** Save the board to disk without preventing multiple simultaneous saves. Use save() instead. */
  async _unsafe_save() {
    return unsafeSaveBoard(this);
  }

  /** Remove old elements from the board */
  clean() {
    if (this.liveItemCount > this.maxItemCount) {
      let removed = false;
      while (
        this.liveItemCount > this.maxItemCount &&
        this.trimPaintOrderIndex < this.paintOrder.length
      ) {
        const id = this.paintOrder[this.trimPaintOrderIndex];
        this.trimPaintOrderIndex += 1;
        if (id === undefined) continue;
        const item = this.itemsById.get(id);
        if (!item || item.deleted === true) continue;
        this.itemsById.delete(id);
        this.liveItemCount -= 1;
        removed = true;
      }
      if (removed) {
        this.paintOrder = this.paintOrder.filter((id) =>
          this.itemsById.has(id),
        );
        this.trimPaintOrderIndex = 0;
        rebuildLiveItemCount(this);
      }
    }
  }

  /** Load the data in the board from a file.
   * @param {string} name - name of the board
   * @param {BoardConfig} config
   */
  static async load(name, config) {
    return loadBoardData(BoardData, name, config);
  }
}

export { BoardData, computeScheduledSaveDelayMs };
