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

import MessageCommon from "../../client-data/js/message_common.js";
import { hasMessageId } from "../../client-data/js/message_shape.js";
import {
  getTool,
  getUpdatableFields,
  getMutationType,
  isShapeTool,
  MutationType,
} from "../../client-data/js/message_tool_metadata.js";
import {
  canonicalItemFromItem,
  cloneCanonicalItem,
  copyCanonicalItem,
  currentText,
  effectiveChildCount,
  publicItemFromCanonicalItem,
} from "./canonical_items.mjs";
import { Eraser } from "../../client-data/tools/index.js";
import {
  authoritativeItemCount,
  cloneBounds,
  getCanonicalItem,
  rebuildLiveItemCount,
  removeCanonicalItem,
  upsertCanonicalItem,
} from "./canonical_index.mjs";
import {
  canAddChild as canBoardAddChild,
  canCopy as canBoardCopy,
  canProcessMessage as canBoardProcessMessage,
  canStore as canBoardStore,
  canUpdate as canBoardUpdate,
  collectHydrationIds as collectBoardHydrationIds,
  collectReferencedMutationIds as collectBoardReferencedMutationIds,
  commitMutation as commitBoardMutation,
  preparePersistentMutation as prepareBoardPersistentMutation,
  processMessage as processBoardMessage,
  processMessageBatch as processBoardMessageBatch,
  trimOverflowItems as trimBoardOverflowItems,
} from "./message_processing.mjs";
import {
  clearSaveTimeout as clearBoardSaveTimeout,
  computeScheduledSaveDelayMs,
  delaySave as delayBoardSave,
  dirtyAgeMs as boardDirtyAgeMs,
  disposeBoard,
  finalizePersistedItems as finalizeBoardPersistedItems,
  hasDirtyItems as boardHasDirtyItems,
  loadBoardData,
  saveBoard,
  scheduleDirtySave as scheduleBoardDirtySave,
  scheduleSaveTimeout as scheduleBoardSaveTimeout,
  trimPersistedMutationLog as trimBoardPersistedMutationLog,
  unsafeSaveBoard,
} from "./data_persistence.mjs";
import { createMutationLog } from "./mutation_log.mjs";
import observability from "../observability/index.mjs";
import { boardSvgPath } from "../persistence/svg_board_paths.mjs";

const { logger } = observability;
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
/** @typedef {ValidationSuccess | ValidationFailure} BoardMutationResult */
/** @typedef {{ok: true, value: BoardElem, canonical: CanonicalBoardItem, localBounds: Bounds | null}} ValidatedStoredCandidate */
/** @typedef {import("../../types/app-runtime.d.ts").BoardMessage} BoardMessage */
/** @typedef {import("../../types/app-runtime.d.ts").ToolOwnedChildMessage} ToolOwnedChildMessage */
/** @typedef {import("../../types/app-runtime.d.ts").Transform} Transform */
/** @typedef {import("../../types/server-runtime.d.ts").MutationLogEntry} MutationLogEntry */
/** @typedef {import("../../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
/** @typedef {{x: number, y: number}} ChildPoint */
/** @typedef {{kind: "inline"} | {kind: "text", modifiedText?: string} | {kind: "children", persistedChildCount: number, appendedChildren: ChildPoint[]}} CanonicalPayload */
/** @typedef {"saved" | "skipped" | "stale" | "failed"} BoardSaveStatus */
/** @typedef {{status: BoardSaveStatus}} BoardSaveResult */
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
/** @typedef {{mutation: NormalizedMessageData}} PendingMutationEffect */
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

/** @param {string} id */
function eraserDeleteMutation(id) {
  return { tool: Eraser.id, type: MutationType.DELETE, id };
}

/**
 * @param {unknown} raw
 * @param {number} maxBoardSize
 * @returns {{ok: true, value: ChildPoint} | ValidationFailure}
 */
function validateChildPoint(raw, maxBoardSize) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "expected object" };
  }
  const point = /** @type {{x?: unknown, y?: unknown}} */ (raw);
  const x = MessageCommon.normalizeBoardCoord(point.x, maxBoardSize);
  const y = MessageCommon.normalizeBoardCoord(point.y, maxBoardSize);
  if (x === null || y === null) {
    return { ok: false, reason: "invalid coord" };
  }
  return { ok: true, value: { x, y } };
}

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
    /** @type {PendingMutationEffect[]} */
    this.pendingRejectedMutationEffects = [];
    /** @type {PendingMutationEffect[]} */
    this.pendingAcceptedMutationEffects = [];
    /** @type {Map<string, CanonicalBoardItem>} */
    this.itemsById = new Map();
    /** @type {string[]} */
    this.paintOrder = [];
    this.nextPaintOrder = 0;
    this.liveItemCount = 0;
    this.trimPaintOrderIndex = 0;
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
    let paintOrder = 0;
    for (const [id, item] of Object.entries(value || {})) {
      const canonical = canonicalItemFromItem({ ...item, id }, paintOrder, {
        persisted: false,
      });
      if (!canonical) continue;
      upsertCanonicalItem(this, canonical);
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
   * @returns {PendingMutationEffect[]}
   */
  consumePendingRejectedMutationEffects() {
    const effects = this.pendingRejectedMutationEffects;
    this.pendingRejectedMutationEffects = [];
    return effects;
  }

  /**
   * @returns {PendingMutationEffect[]}
   */
  consumePendingAcceptedMutationEffects() {
    const effects = this.pendingAcceptedMutationEffects;
    this.pendingAcceptedMutationEffects = [];
    return effects;
  }

  /**
   * @returns {{ok: true}}
   */
  commitMutation() {
    return commitBoardMutation(this);
  }

  /**
   * @returns {number}
   */
  authoritativeItemCount() {
    return authoritativeItemCount(this);
  }

  /**
   * @returns {PendingMutationEffect[]}
   */
  trimOverflowItems() {
    return trimBoardOverflowItems(this);
  }

  /**
   * @param {string} id
   * @param {any} [item]
   * @returns {Bounds | null}
   */
  getLocalBounds(id, item) {
    const target = item || getCanonicalItem(this, id);
    return cloneBounds(target?.bounds);
  }

  /**
   * @param {string} id
   * @param {BoardElem} data
   * @returns {ValidatedStoredCandidate | ValidationFailure}
   */
  validateStoredCandidate(id, data) {
    const candidate = this.asStoredCandidateInput(data);
    const canonical = canonicalItemFromItem(candidate, this.nextPaintOrder, {
      persisted: false,
    });
    if (!canonical) return { ok: false, reason: "invalid message" };
    if (canonical.id !== id) return { ok: false, reason: "invalid id" };
    if (this.isCandidateTooLarge(candidate, canonical.bounds)) {
      return { ok: false, reason: "shape too large" };
    }
    /** @type {ValidatedStoredCandidate} */
    return {
      ok: true,
      value: candidate,
      canonical,
      localBounds: canonical.bounds,
    };
  }

  /**
   * Live create messages use numeric mutation codes, but canonical board items
   * still store SVG tag names because persistence stays SVG-native.
   *
   * @param {BoardElem} data
   * @returns {BoardElem}
   */
  asStoredCandidateInput(data) {
    if (getMutationType(data) !== MutationType.CREATE) return data;
    const contract = getTool(data?.tool);
    if (!contract?.storedTagName) return data;
    return {
      ...data,
      tool: contract.toolId,
      type: contract.storedTagName,
    };
  }

  /**
   * @param {BoardElem} candidate
   * @param {Bounds | null | undefined} localBounds
   * @returns {boolean}
   */
  isCandidateTooLarge(candidate, localBounds) {
    const effectiveBounds = MessageCommon.applyTransformToBounds(
      localBounds,
      candidate?.transform,
    );
    return MessageCommon.isBoundsInvalid(effectiveBounds, this.maxBoardSize);
  }

  /**
   * @param {BoardElem} base
   * @param {BoardElem} updateData
   * @returns {boolean}
   */
  isTextContentOnlyUpdate(base, updateData) {
    return !!(
      base?.payload?.kind === "text" &&
      updateData &&
      typeof updateData === "object" &&
      typeof updateData.txt === "string" &&
      Object.keys(updateData).every((key) => key === "txt")
    );
  }

  /**
   * @param {BoardElem} base
   * @param {BoardElem} updateData
   * @param {{value: BoardElem, localBounds: Bounds | null}} candidate
   * @returns {boolean}
   */
  isUpdateCandidateTooLarge(base, updateData, candidate) {
    const effectiveBounds = MessageCommon.applyTransformToBounds(
      candidate.localBounds,
      candidate.value?.transform,
    );
    if (this.isTextContentOnlyUpdate(base, updateData)) {
      return MessageCommon.isBoundsTooLarge(effectiveBounds);
    }
    return MessageCommon.isBoundsInvalid(effectiveBounds, this.maxBoardSize);
  }

  /**
   * @param {BoardElem} item
   * @param {string} id
   * @returns {boolean}
   */
  hasZeroLocalExtent(item, id) {
    const bounds = this.getLocalBounds(id, item);
    if (!bounds) return false;
    return bounds.minX === bounds.maxX && bounds.minY === bounds.maxY;
  }

  /**
   * @param {any} summary
   * @returns {boolean}
   */
  hasZeroSummaryExtent(summary) {
    const bounds = summary?.bounds;
    return !!(
      bounds &&
      bounds.minX === bounds.maxX &&
      bounds.minY === bounds.maxY
    );
  }

  /**
   * @param {string | undefined} tool
   * @param {BoardElem} item
   * @param {string} id
   * @returns {boolean}
   */
  shouldDropSeedShapeOnRejectedUpdate(tool, item, id) {
    return (
      isShapeTool(tool) &&
      item &&
      getTool(item.tool)?.id === getTool(tool)?.id &&
      this.hasZeroLocalExtent(item, id) &&
      item.transform === undefined
    );
  }

  /**
   * @param {BoardMessage} message
   * @returns {boolean}
   */
  shouldDeferSeedDropRejectionToMutationEngine(message) {
    if (
      getMutationType(message) !== MutationType.UPDATE ||
      !hasMessageId(message)
    ) {
      return false;
    }
    const summary = getCanonicalItem(this, message.id);
    return (
      isShapeTool(message.tool) &&
      getTool(summary?.tool)?.id === getTool(message.tool)?.id &&
      this.hasZeroSummaryExtent(summary) &&
      summary.transform === undefined
    );
  }

  /**
   * @param {BoardMessage | ToolOwnedChildMessage} message
   * @returns {Set<string>}
   */
  collectReferencedMutationIds(message) {
    return collectBoardReferencedMutationIds(this, message);
  }

  /**
   * @param {BoardMessage | ToolOwnedChildMessage} message
   * @returns {Set<string>}
   */
  collectHydrationIds(message) {
    return collectBoardHydrationIds(this, message);
  }

  /**
   * @param {NormalizedMessageData} message
   * @returns {Promise<{ok: true, mutation: NormalizedMessageData} | {ok: false, reason: string}>}
   */
  async preparePersistentMutation(message) {
    return prepareBoardPersistentMutation(this, message);
  }

  canStore(/** @type {string} */ id, /** @type {BoardElem} */ data) {
    return canBoardStore(this, id, data);
  }

  canUpdate(/** @type {string} */ id, /** @type {BoardElem} */ updateData) {
    return canBoardUpdate(this, id, updateData);
  }

  /**
   * @param {string} id
   * @param {BoardElem} base
   * @param {BoardElem} updateData
   * @returns {{value: BoardElem, localBounds: Bounds | null} | null}
   */
  makeUpdateCandidate(id, base, updateData) {
    if (typeof base !== "object") return null;
    if (this.isTransformOnlyUpdate(updateData)) {
      return {
        value: {
          id,
          tool: base.tool,
          transform: structuredClone(updateData.transform),
        },
        localBounds: this.getLocalBounds(id, base),
      };
    }
    const candidate = publicItemFromCanonicalItem(base);
    if (!candidate) return null;
    Object.assign(candidate, updateData);
    const localBounds =
      base.payload?.kind === "children" && updateData.transform !== undefined
        ? cloneBounds(base.bounds)
        : MessageCommon.getLocalGeometryBounds(candidate);
    return { value: candidate, localBounds };
  }

  /**
   * @param {BoardElem} updateData
   * @returns {boolean}
   */
  isTransformOnlyUpdate(updateData) {
    return !!(
      updateData &&
      typeof updateData === "object" &&
      updateData.transform !== undefined &&
      Object.keys(updateData).every((key) => key === "transform")
    );
  }

  /**
   * @param {any} item
   * @param {BoardElem} updateData
   * @param {Bounds | null | undefined} localBounds
   * @returns {any}
   */
  applyUpdateToCanonicalItem(item, updateData, localBounds) {
    const next = this.isTransformOnlyUpdate(updateData)
      ? {
          ...item,
          attrs: {
            ...item.attrs,
          },
          bounds: cloneBounds(localBounds),
        }
      : cloneCanonicalItem(item);
    for (const key in updateData) {
      if (updateData[key] !== undefined) {
        if (key === "transform") {
          next.transform = structuredClone(updateData[key]);
        } else {
          next.attrs[key] = updateData[key];
        }
      }
    }
    if (next.payload?.kind === "text" && typeof updateData.txt === "string") {
      next.payload.modifiedText = updateData.txt;
      next.textLength = updateData.txt.length;
    }
    const boundsItem = publicItemFromCanonicalItem(next);
    const text = currentText(next);
    if (boundsItem && text !== undefined) boundsItem.txt = text;
    next.bounds = cloneBounds(
      this.isTransformOnlyUpdate(updateData)
        ? localBounds
        : MessageCommon.getLocalGeometryBounds(boundsItem),
    );
    next.dirty = true;
    next.time = Date.now();
    next.attrs.time = next.time;
    return next;
  }

  canAddChild(/** @type {string} */ parentId, /** @type {BoardElem} */ child) {
    return canBoardAddChild(this, parentId, child);
  }

  canCopy(/** @type {string} */ id, /** @type {BoardElem} */ data) {
    return canBoardCopy(this, id, data);
  }

  /**
   * @param {any} item
   * @returns {string | undefined}
   */
  baselineSourceIdForItem(item) {
    const sourceId = item?.copySource?.sourceId;
    if (typeof sourceId === "string") return sourceId;
    if (typeof item?.id === "string" && this.persistedItemIds.has(item.id)) {
      return item.id;
    }
    return undefined;
  }

  /**
   * Copies a stored item to a new id without re-running full stored-item
   * normalization. Board state is already normalized, so only the new id and
   * mutable containers need isolation.
   *
   * @param {string} newId
   * @param {BoardElem} item
   * @returns {ValidatedStoredCandidate | ValidationFailure}
   */
  makeCopyCandidate(newId, item) {
    const normalizedId = MessageCommon.normalizeId(newId);
    if (normalizedId === null) return { ok: false, reason: "invalid id" };
    if (typeof item !== "object") {
      return { ok: false, reason: "copied object does not exist" };
    }
    const existing = this.itemsById.get(normalizedId);
    const copied = copyCanonicalItem(
      item,
      normalizedId,
      existing?.paintOrder ?? this.nextPaintOrder,
    );
    const baselineSourceId = this.baselineSourceIdForItem(item);
    if (copied.payload?.kind === "children" && baselineSourceId) {
      copied.copySource = { sourceId: baselineSourceId };
    } else if (
      copied.payload?.kind === "text" &&
      currentText(copied) === undefined &&
      baselineSourceId
    ) {
      copied.copySource = { sourceId: baselineSourceId };
    }
    return {
      ok: true,
      value: copied,
      canonical: copied,
      localBounds: cloneBounds(copied.bounds),
    };
  }

  canProcessMessage(/** @type {BoardMessage} */ message) {
    return canBoardProcessMessage(this, message);
  }

  /** Adds data to the board
   * @param {string} id
   * @param {BoardElem} data
   * @returns {BoardMutationResult | ValidationFailure}
   */
  set(id, data) {
    const validated = this.validateStoredCandidate(id, {
      ...data,
      time: Date.now(),
    });
    if (!validated.ok) return validated;
    const existing = this.itemsById.get(id);
    const canonical = {
      ...validated.canonical,
      paintOrder: existing?.paintOrder ?? this.nextPaintOrder,
    };
    upsertCanonicalItem(this, canonical);
    this.delaySave();
    return this.commitMutation();
  }

  /** Adds a child to an element that is already in the board
   * @param {string} parentId - Identifier of the parent element.
   * @param {BoardElem} child - Object containing the the values to update.
   * @returns {BoardMutationResult | ValidationFailure} - True if the child was added, else false
   */
  addChild(parentId, child) {
    const next = this.makeAppendCandidate(parentId, child);
    if (!next.ok) return next;
    upsertCanonicalItem(this, next.value);
    this.delaySave();
    return this.commitMutation();
  }

  /**
   * @param {string} parentId
   * @param {BoardElem} child
   * @param {any} [item]
   * @returns {{ok: true, value: any} | ValidationFailure}
   */
  makeAppendCandidate(parentId, child, item) {
    const current = item || getCanonicalItem(this, parentId);
    if (typeof current !== "object" || current.payload?.kind !== "children") {
      return { ok: false, reason: "invalid parent for child" };
    }
    const normalizedChild = validateChildPoint(child, this.maxBoardSize);
    if (!normalizedChild.ok) return normalizedChild;
    if (effectiveChildCount(current) >= this.maxChildren) {
      return { ok: false, reason: "too many children" };
    }
    const nextBounds = MessageCommon.extendBoundsWithPoint(
      current.bounds,
      normalizedChild.value.x,
      normalizedChild.value.y,
    );
    if (this.isCandidateTooLarge(current, nextBounds)) {
      return { ok: false, reason: "shape too large" };
    }
    const next = cloneCanonicalItem(current);
    next.payload.appendedChildren = (
      next.payload.appendedChildren || []
    ).concat(normalizedChild.value);
    next.bounds = cloneBounds(nextBounds);
    next.dirty = true;
    next.time = Date.now();
    next.attrs.time = next.time;
    return { ok: true, value: next };
  }

  /** Update the data in the board
   * @param {string} id - Identifier of the data to update.
   * @param {BoardElem} data - Object containing the values to update.
   * @param {boolean} [create] - True if the object should be created if it's not currently in the DB.
   * @returns {BoardMutationResult}
   */
  update(id, data, create = false) {
    void create;
    const tool = data.tool;
    const updateData = getUpdatableFields(tool, data);

    const obj = getCanonicalItem(this, id);
    if (typeof obj !== "object")
      return { ok: false, reason: "object not found" };
    if (!this.canUpdate(id, updateData)) {
      if (this.shouldDropSeedShapeOnRejectedUpdate(obj.tool, obj, id)) {
        const deleteResult = this.delete(id);
        if (deleteResult.ok)
          this.pendingRejectedMutationEffects.push({
            mutation: eraserDeleteMutation(id),
          });
      }
      return { ok: false, reason: "update rejected: shape too large" };
    }
    const next = this.applyUpdateToCanonicalItem(
      obj,
      updateData,
      this.makeUpdateCandidate(id, obj, updateData)?.localBounds,
    );
    upsertCanonicalItem(this, next);
    this.delaySave();
    return this.commitMutation();
  }

  /**
   * @param {string} id
   * @param {BoardElem} item
   * @param {Bounds | null | undefined} localBounds
   * @returns {void}
   */
  replaceItem(id, item, localBounds) {
    const next = cloneCanonicalItem(item);
    next.id = id;
    next.bounds = cloneBounds(localBounds);
    upsertCanonicalItem(this, next);
  }

  /** Copy elements in the board
   * @param {string} id - Identifier of the data to copy.
   * @param {BoardElem} data - Object containing the id of the new copied element.
   * @returns {BoardMutationResult | ValidationFailure}
   */
  copy(id, data) {
    const obj = getCanonicalItem(this, id);
    const newid = data.newid;
    if (obj) {
      const validated = this.makeCopyCandidate(newid, obj);
      if (!validated.ok) return validated;
      upsertCanonicalItem(this, validated.value);
    } else {
      logger.warn("board.copy_missing_source", {
        board: this.name,
        object: id,
      });
      return { ok: false, reason: "copied object does not exist" };
    }
    this.delaySave();
    return this.commitMutation();
  }

  /** Clear the board of all data
   * @returns {ValidationSuccess}
   */
  clear() {
    for (const [id, item] of this.itemsById.entries()) {
      this.itemsById.set(id, {
        ...item,
        deleted: true,
        dirty: true,
      });
    }
    this.liveItemCount = 0;
    this.trimPaintOrderIndex = this.paintOrder.length;
    this.delaySave();
    return this.commitMutation();
  }

  /** Removes data from the board
   * @param {string} id - Identifier of the data to delete.
   * @returns {ValidationSuccess}
   */
  delete(id) {
    //KISS
    removeCanonicalItem(this, id);
    this.delaySave();
    return this.commitMutation();
  }

  /** Process a batch of messages
   * @param {(BoardMessage | ToolOwnedChildMessage)[]} children array of messages to be delegated to the other methods
   * @param {BoardMessage} [parentMessage]
   * @returns {BoardMutationResult | ValidationFailure}
   */
  processMessageBatch(children, parentMessage) {
    return processBoardMessageBatch(this, children, parentMessage);
  }

  /** Process a single message
   * @param {BoardMessage} message instruction to apply to the board
   * @returns {BoardMutationResult | ValidationFailure}
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

export { BoardData };
export { computeScheduledSaveDelayMs };
