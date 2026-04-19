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

import { stat } from "node:fs/promises";
import MessageCommon from "../client-data/js/message_common.js";
import MessageToolMetadata from "../client-data/js/message_tool_metadata.js";
import {
  canonicalItemFromItem,
  cloneCanonicalItem,
  copyCanonicalItem,
  effectiveChildCount,
  publicItemFromCanonicalItem,
} from "./canonical_board_items.mjs";
import {
  authoritativeItemCount,
  cloneBounds,
  finalizePersistedCanonicalItems,
  getCanonicalItem,
  rebuildDirtyCreatedItems,
  removeCanonicalItem,
  upsertCanonicalItem,
} from "./board_canonical_index.mjs";
import { readConfiguration } from "./configuration.mjs";
import { boardJsonPath } from "./legacy_json_board_source.mjs";
import {
  normalizeStoredChildPoint,
  normalizeStoredItemWithBounds,
} from "./message_validation.mjs";
import { createMutationLog } from "./mutation_log.mjs";
import observability from "./observability.mjs";
import {
  boardSvgBackupPath,
  boardSvgPath,
  readCanonicalBoardState,
  rewriteStoredSvgFromCanonical,
  writeCanonicalBoardState,
} from "./svg_board_store.mjs";

const { logger, metrics, tracing } = observability;
/** @returns {BoardMetadata} */
function defaultBoardMetadata() {
  return {
    readonly: false,
  };
}

class SerialTaskQueue {
  constructor() {
    this.lastTask = Promise.resolve();
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  runExclusive(task) {
    const runTask = () => task();
    const result = this.lastTask.then(runTask, runTask);
    this.lastTask = result.then(
      function clearTask() {},
      function swallowTaskError() {},
    );
    return result;
  }
}

const STANDALONE_BOARD_LOAD_BYTES_THRESHOLD = 1024 * 1024;
const STANDALONE_BOARD_SAVE_ITEM_COUNT_THRESHOLD = 2048;
const STANDALONE_BOARD_BATCH_CHILD_COUNT_THRESHOLD = 64;
const INITIAL_BASELINE_SAVE_DELAY_MS = 50;
let boardInstanceSequence = 0;
/** @typedef {{minX: number, minY: number, maxX: number, maxY: number}} Bounds */
/** @typedef {{readonly: boolean}} BoardMetadata */
/** @typedef {{ok: false, reason: string}} ValidationFailure */
/** @typedef {{ok: true}} ValidationSuccess */
/** @typedef {ValidationSuccess | ValidationFailure} BoardMutationResult */
/** @typedef {{ok: true, value: BoardElem, localBounds: Bounds | null}} ValidatedStoredCandidate */
/** @typedef {import("../types/app-runtime.d.ts").BoardMessage} BoardMessage */

/**
 * @param {string} name
 * @param {string} [historyDir]
 * @returns {string}
 */
function boardFilePath(name, historyDir) {
  return boardSvgPath(name, historyDir);
}

/**
 * @param {string} boardName
 * @param {string} operation
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function boardTraceAttributes(boardName, operation, extras) {
  return {
    "wbo.board": boardName,
    "wbo.board.operation": operation,
    ...extras,
  };
}

/**
 * @param {BoardData} board
 * @returns {number}
 */
function countDirtyItems(board) {
  let count = 0;
  for (const item of board.itemsById.values()) {
    if (item?.dirty === true) count += 1;
  }
  return count;
}

/**
 * @param {BoardData} board
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function boardDebugFields(board, extras) {
  return {
    board: board.name,
    "wbo.board.instance": board.instanceId,
    "wbo.board.seq": board.getSeq(),
    "wbo.board.persisted_seq": board.getPersistedSeq(),
    "wbo.board.min_replayable_seq": board.minReplayableSeq(),
    "wbo.board.has_persisted_baseline": board.hasPersistedBaseline,
    "wbo.board.items": board.authoritativeItemCount(),
    "wbo.board.dirty_items": countDirtyItems(board),
    "wbo.board.dirty_created_items": board.dirtyCreatedIds.size,
    "wbo.board.users": board.users.size,
    "file.path": board.file,
    "wbo.board.item_ids": [...board.paintOrder],
    ...(extras || {}),
  };
}

/**
 * @param {string | undefined} tool
 * @param {BoardElem} data
 * @returns {BoardElem}
 */
function filterUpdatableFields(tool, data) {
  return MessageToolMetadata.getUpdatableFields(tool, data);
}

/**
 * @param {{saveIntervalMs: number, hasPersistedBaseline: boolean, hasDirtyCreatedItems?: boolean}} options
 * @returns {number}
 */
function computeSaveDelayMs(options) {
  const normalizedSaveInterval = Math.max(
    0,
    Number(options.saveIntervalMs) || 0,
  );
  if (options.hasPersistedBaseline && options.hasDirtyCreatedItems !== true) {
    return normalizedSaveInterval;
  }
  return Math.min(normalizedSaveInterval, INITIAL_BASELINE_SAVE_DELAY_MS);
}

/**
 * @param {BoardData} board
 * @param {number} fromExclusiveSeq
 * @param {number} toInclusiveSeq
 * @returns {BoardData}
 */
function replayRecoverableMutations(board, fromExclusiveSeq, toInclusiveSeq) {
  const recovered = new BoardData(board.name);
  recovered.loadSource = board.loadSource;
  recovered.metadata = structuredClone(board.metadata);
  recovered.historyDir = board.historyDir;
  recovered.file = board.file;
  recovered.delaySave = () => {};
  recovered.scheduleSaveTimeout = () => {};
  for (const envelope of board.readMutationRange(
    fromExclusiveSeq,
    toInclusiveSeq,
  )) {
    recovered.processMessage(structuredClone(envelope.mutation));
  }
  return recovered;
}

/**
 * @param {BoardData} board
 * @param {BoardData} snapshot
 * @returns {void}
 */
function replaceBoardState(board, snapshot) {
  board.itemsById = new Map(snapshot.itemsById);
  board.paintOrder = [...snapshot.paintOrder];
  board.nextPaintOrder = snapshot.nextPaintOrder;
  board.dirtyCreatedIds = new Set(snapshot.dirtyCreatedIds);
}

/**
 * Represents a board.
 * @typedef {{[object_id:string]: any}} BoardElem
 */
class BoardData {
  /**
   * @param {string} name
   */
  constructor(name) {
    this.name = name;
    this.instanceId = ++boardInstanceSequence;
    this.loadSource = "empty";
    this.metadata = defaultBoardMetadata();
    this.historyDir = readConfiguration().HISTORY_DIR;
    this.file = boardFilePath(name, this.historyDir);
    this.hasPersistedBaseline = false;
    this.lastSaveDate = Date.now();
    this.users = new Set();
    this.saveMutex = new SerialTaskQueue();
    this.mutationLog = createMutationLog(0);
    /** @type {Array<{mutation: any}>} */
    this.pendingRejectedMutationEffects = [];
    /** @type {Map<string, any>} */
    this.itemsById = new Map();
    /** @type {string[]} */
    this.paintOrder = [];
    this.nextPaintOrder = 0;
    this.dirtyCreatedIds = new Set();
    this.disposed = false;
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
    this.dirtyCreatedIds = new Set();
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
   * @param {number} toInclusiveSeq
   * @returns {ReturnType<ReturnType<typeof createMutationLog>["readRange"]>}
   */
  readMutationRange(fromExclusiveSeq, toInclusiveSeq) {
    return this.mutationLog.readRange(fromExclusiveSeq, toInclusiveSeq);
  }

  /**
   * @param {BoardMessage} mutation
   * @param {number} [acceptedAtMs]
   * @param {string | undefined} [clientMutationId]
   * @returns {ReturnType<ReturnType<typeof createMutationLog>["append"]>}
   */
  recordPersistentMutation(
    mutation,
    acceptedAtMs = Date.now(),
    clientMutationId,
  ) {
    return this.mutationLog.append({
      board: this.name,
      acceptedAtMs,
      mutation: structuredClone(mutation),
      clientMutationId,
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
    const retentionMs = Math.max(
      0,
      readConfiguration().SEQ_REPLAY_RETENTION_MS,
    );
    this.mutationLog.trimPersistedOlderThan(nowMs - retentionMs);
  }

  /**
   * @returns {Array<{mutation: any}>}
   */
  consumePendingRejectedMutationEffects() {
    const effects = this.pendingRejectedMutationEffects;
    this.pendingRejectedMutationEffects = [];
    return effects;
  }

  /**
   * @returns {{ok: true}}
   */
  commitMutation() {
    return { ok: true };
  }

  /**
   * @returns {number}
   */
  authoritativeItemCount() {
    return authoritativeItemCount(this);
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
    const normalized = normalizeStoredItemWithBounds(data, id);
    if (normalized.ok === false) {
      return { ok: false, reason: normalized.reason };
    }
    /** @type {ValidatedStoredCandidate} */
    return {
      ok: true,
      value: normalized.value.value,
      localBounds: normalized.value.localBounds,
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
    return MessageCommon.isBoundsTooLarge(effectiveBounds);
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
      MessageToolMetadata.isShapeTool(tool) &&
      item &&
      item.tool === tool &&
      this.hasZeroLocalExtent(item, id) &&
      item.transform === undefined
    );
  }

  /**
   * @param {BoardMessage} message
   * @returns {boolean}
   */
  shouldDeferSeedDropRejectionToMutationEngine(message) {
    if (message?.type !== "update" || !message.id) return false;
    const summary = getCanonicalItem(this, message.id);
    return (
      MessageToolMetadata.isShapeTool(message.tool) &&
      summary?.tool === message.tool &&
      this.hasZeroSummaryExtent(summary) &&
      summary.transform === undefined
    );
  }

  /**
   * @param {BoardMessage} message
   * @returns {Set<string>}
   */
  collectReferencedMutationIds(message) {
    const ids = new Set();
    if (!message || typeof message !== "object") return ids;
    if (Array.isArray(message._children)) {
      message._children.forEach((child) => {
        this.collectReferencedMutationIds({
          ...child,
          tool: message.tool,
        }).forEach((id) => ids.add(id));
      });
      return ids;
    }
    if (typeof message.id === "string") {
      ids.add(message.id);
    }
    if (typeof message.parent === "string") {
      ids.add(message.parent);
    }
    return ids;
  }

  /**
   * @param {BoardMessage} message
   * @returns {Set<string>}
   */
  collectHydrationIds(message) {
    const ids = new Set();
    if (!message || typeof message !== "object") return ids;
    if (Array.isArray(message._children)) {
      message._children.forEach((child) => {
        this.collectHydrationIds({
          ...child,
          tool: message.tool,
        }).forEach((id) => ids.add(id));
      });
      return ids;
    }
    switch (message.type) {
      case "update":
      case "copy":
        if (typeof message.id === "string") ids.add(message.id);
        break;
      case "child":
        if (typeof message.parent === "string") ids.add(message.parent);
        break;
    }
    return ids;
  }

  /**
   * @param {BoardMessage} message
   * @returns {Promise<{ok: true, mutation: BoardMessage} | {ok: false, reason: string}>}
   */
  async preparePersistentMutation(message) {
    if (Array.isArray(message?._children)) {
      return { ok: true, mutation: message };
    }
    switch (message?.type) {
      case "copy":
        if (!message.id || !getCanonicalItem(this, message.id)) {
          return { ok: false, reason: "copied object does not exist" };
        }
        return { ok: true, mutation: message };
      case "child":
        if (!message.parent || !getCanonicalItem(this, message.parent)) {
          return { ok: false, reason: "invalid parent for child" };
        }
        return this.canAddChild(message.parent, message)
          ? { ok: true, mutation: message }
          : { ok: false, reason: "shape too large" };
      case "update":
        if (!message.id || !getCanonicalItem(this, message.id)) {
          return { ok: false, reason: "object not found" };
        }
        if (
          this.canUpdate(
            message.id,
            filterUpdatableFields(message.tool, message),
          )
        ) {
          return { ok: true, mutation: message };
        }
        if (this.shouldDeferSeedDropRejectionToMutationEngine(message)) {
          return { ok: true, mutation: message };
        }
        return { ok: false, reason: "shape too large" };
      default:
        return { ok: true, mutation: message };
    }
  }

  /**
   * @param {string} id
   * @param {BoardElem} data
   * @returns {boolean}
   */
  canStore(id, data) {
    return this.validateStoredCandidate(id, data).ok;
  }

  /**
   * @param {string} id
   * @param {BoardElem} updateData
   * @returns {boolean}
   */
  canUpdate(id, updateData) {
    const obj = getCanonicalItem(this, id);
    if (typeof obj !== "object") return false;

    const candidate = this.makeUpdateCandidate(id, obj, updateData);
    if (!candidate) return false;

    return !this.isCandidateTooLarge(candidate.value, candidate.localBounds);
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
      base.tool === "Pencil" && updateData.transform !== undefined
        ? this.getLocalBounds(id, base)
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
          next.attrs.transform = structuredClone(updateData[key]);
        } else {
          next.attrs[key] = updateData[key];
        }
      }
    }
    if (next.payload?.kind === "text" && typeof updateData.txt === "string") {
      next.payload.modifiedText = updateData.txt;
      next.textLength = updateData.txt.length;
    }
    next.bounds = cloneBounds(
      this.isTransformOnlyUpdate(updateData)
        ? localBounds
        : MessageCommon.getLocalGeometryBounds({
            ...publicItemFromCanonicalItem(next),
            ...(next.payload?.kind === "text" &&
            typeof next.payload.modifiedText === "string"
              ? { txt: next.payload.modifiedText }
              : {}),
          }),
    );
    next.dirty = true;
    next.time = Date.now();
    next.attrs.time = next.time;
    return next;
  }

  /**
   * @param {string} id
   * @param {BoardElem} obj
   * @param {BoardElem} updateData
   * @returns {boolean}
   */
  isIncrementalUpdateTooLarge(id, obj, updateData) {
    if (obj.tool === "Pencil") {
      const nextBounds = MessageCommon.extendBoundsWithPoint(
        this.getLocalBounds(id, obj),
        updateData.x,
        updateData.y,
      );
      return this.isCandidateTooLarge(obj, nextBounds);
    }
    if (obj.tool === "Text") {
      const candidate = {
        ...publicItemFromCanonicalItem(obj),
        txt: updateData.txt,
      };
      const nextBounds = MessageCommon.getLocalGeometryBounds(candidate);
      return this.isCandidateTooLarge(candidate, nextBounds);
    }
    return false;
  }

  /**
   * @param {string} parentId
   * @param {BoardElem} child
   * @returns {boolean}
   */
  canAddChild(parentId, child) {
    const obj = getCanonicalItem(this, parentId);
    if (!obj || obj.tool !== "Pencil") return false;

    const normalizedChild = normalizeStoredChildPoint(child);
    if (!normalizedChild.ok) return false;
    if (effectiveChildCount(obj) >= readConfiguration().MAX_CHILDREN)
      return false;

    return !this.isIncrementalUpdateTooLarge(
      parentId,
      obj,
      normalizedChild.value,
    );
  }

  /**
   * @param {string} id
   * @param {BoardElem} data
   * @returns {boolean}
   */
  canCopy(id, data) {
    const obj = getCanonicalItem(this, id);
    if (!obj) return false;
    return this.makeCopyCandidate(data.newid, obj).ok;
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
    return {
      ok: true,
      value: copied,
      localBounds: cloneBounds(copied.bounds),
    };
  }

  /**
   * @param {BoardMessage} message
   * @returns {boolean}
   */
  canProcessMessage(message) {
    const id = message.id;
    switch (message.type) {
      case "delete":
      case "clear":
        return true;
      case "update":
        return id
          ? this.canUpdate(id, filterUpdatableFields(message.tool, message))
          : false;
      case "copy":
        return id ? this.canCopy(id, message) : false;
      case "child":
        return message.parent
          ? this.canAddChild(message.parent, message)
          : false;
      default:
        return id ? this.canStore(id, message) : false;
    }
  }

  /** Adds data to the board
   * @param {string} id
   * @param {BoardElem} data
   * @returns {BoardMutationResult | ValidationFailure}
   */
  set(id, data) {
    //KISS
    data.time = Date.now();
    const validated = this.validateStoredCandidate(id, data);
    if (!validated.ok) return validated;
    const existing = this.itemsById.get(id);
    const canonical = canonicalItemFromItem(
      validated.value,
      existing?.paintOrder ?? this.nextPaintOrder,
      {
        persisted: false,
      },
    );
    if (!canonical) {
      return { ok: false, reason: "invalid message" };
    }
    if (existing && existing.createdAfterPersistedSeq !== true) {
      canonical.createdAfterPersistedSeq = false;
    }
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
    const obj = getCanonicalItem(this, parentId);
    if (typeof obj !== "object" || obj.tool !== "Pencil")
      return { ok: false, reason: "invalid parent for child" };
    const normalizedChild = normalizeStoredChildPoint(child);
    if (!normalizedChild.ok) return normalizedChild;
    if (effectiveChildCount(obj) >= readConfiguration().MAX_CHILDREN)
      return { ok: false, reason: "too many children" };
    const nextBounds = MessageCommon.extendBoundsWithPoint(
      this.getLocalBounds(parentId, obj),
      normalizedChild.value.x,
      normalizedChild.value.y,
    );
    if (this.isCandidateTooLarge(obj, nextBounds))
      return { ok: false, reason: "shape too large" };
    const next = cloneCanonicalItem(obj);
    next.payload.appendedChildren = (
      next.payload.appendedChildren || []
    ).concat(normalizedChild.value);
    next.bounds = cloneBounds(nextBounds);
    next.dirty = true;
    next.time = Date.now();
    next.attrs.time = next.time;
    upsertCanonicalItem(this, next);
    this.delaySave();
    return this.commitMutation();
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
    const updateData = filterUpdatableFields(tool, data);

    const obj = getCanonicalItem(this, id);
    if (typeof obj !== "object")
      return { ok: false, reason: "object not found" };
    if (!this.canUpdate(id, updateData)) {
      if (this.shouldDropSeedShapeOnRejectedUpdate(obj.tool, obj, id)) {
        const deleteResult = this.delete(id);
        if (deleteResult.ok)
          this.pendingRejectedMutationEffects.push({
            mutation: {
              tool: "Eraser",
              type: "delete",
              id: id,
            },
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
   * @param {BoardMessage[]} children array of messages to be delegated to the other methods
   * @param {BoardMessage} [parentMessage]
   * @returns {BoardMutationResult | ValidationFailure}
   */
  processMessageBatch(children, parentMessage) {
    return tracing.withExpensiveActiveSpan(
      "board.process_message_batch",
      {
        attributes: boardTraceAttributes(this.name, "process_message_batch", {
          "wbo.message.count": children.length,
          "wbo.message.tool": parentMessage?.tool,
        }),
        traceRoot:
          children.length >= STANDALONE_BOARD_BATCH_CHILD_COUNT_THRESHOLD,
      },
      () => {
        const messages = children.map((childMessage) =>
          parentMessage && childMessage.tool === undefined
            ? { tool: parentMessage.tool, ...childMessage }
            : childMessage,
        );
        /** @type {Map<string, any | undefined>} */
        const overlay = new Map();
        let clearAll = false;

        /**
         * @param {string} id
         * @returns {any}
         */
        const readItem = (id) => {
          if (overlay.has(id)) return overlay.get(id);
          if (clearAll) return undefined;
          return getCanonicalItem(this, id);
        };

        for (const message of messages) {
          const id = message.id;
          switch (message.type) {
            case "clear":
              clearAll = true;
              overlay.clear();
              break;
            case "delete":
              if (!id) return { ok: false, reason: "missing id" };
              overlay.set(id, undefined);
              break;
            case "update": {
              if (!id) return { ok: false, reason: "missing id" };
              const current = readItem(id);
              if (!current) return { ok: false, reason: "object not found" };
              const updateData = filterUpdatableFields(message.tool, message);
              const candidate = this.makeUpdateCandidate(
                id,
                current,
                updateData,
              );
              if (!candidate) {
                return { ok: false, reason: "object not found" };
              }
              if (
                this.isCandidateTooLarge(candidate.value, candidate.localBounds)
              ) {
                return { ok: false, reason: "shape too large" };
              }
              const next = this.applyUpdateToCanonicalItem(
                current,
                updateData,
                candidate.localBounds,
              );
              overlay.set(id, next);
              break;
            }
            case "copy": {
              if (!id || !message.newid) {
                return { ok: false, reason: "missing id" };
              }
              const current = readItem(id);
              if (!current) {
                return { ok: false, reason: "copied object does not exist" };
              }
              const existingTarget = readItem(message.newid);
              const validated = this.makeCopyCandidate(message.newid, current);
              if (!validated.ok) return validated;
              validated.value.paintOrder =
                existingTarget?.paintOrder ?? validated.value.paintOrder;
              overlay.set(message.newid, validated.value);
              break;
            }
            case "child": {
              if (!message.parent) {
                return { ok: false, reason: "invalid parent for child" };
              }
              const current = readItem(message.parent);
              if (!current || current.tool !== "Pencil") {
                return { ok: false, reason: "invalid parent for child" };
              }
              const normalizedChild = normalizeStoredChildPoint(message);
              if (!normalizedChild.ok) return normalizedChild;
              if (
                effectiveChildCount(current) >= readConfiguration().MAX_CHILDREN
              ) {
                return { ok: false, reason: "too many children" };
              }
              const nextBounds = MessageCommon.extendBoundsWithPoint(
                this.getLocalBounds(message.parent, current),
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
              overlay.set(message.parent, next);
              break;
            }
            default: {
              if (!id) return { ok: false, reason: "missing id" };
              const validated = this.validateStoredCandidate(id, {
                ...message,
                time: Date.now(),
              });
              if (!validated.ok) return validated;
              const existing = readItem(id);
              const next = canonicalItemFromItem(
                validated.value,
                clearAll
                  ? this.nextPaintOrder
                  : (existing?.paintOrder ?? this.nextPaintOrder),
                { persisted: false },
              );
              if (!next) return { ok: false, reason: "invalid message" };
              if (
                !clearAll &&
                existing &&
                existing.createdAfterPersistedSeq !== true
              ) {
                next.createdAfterPersistedSeq = false;
              }
              overlay.set(id, next);
              break;
            }
          }
        }

        if (clearAll) {
          for (const [id, item] of this.itemsById.entries()) {
            this.itemsById.set(id, {
              ...item,
              deleted: true,
              dirty: true,
            });
          }
        }
        for (const [id, item] of overlay.entries()) {
          if (item === undefined) {
            removeCanonicalItem(this, id);
          } else {
            upsertCanonicalItem(this, item);
          }
        }
        if (clearAll || overlay.size > 0) this.delaySave();
        return this.commitMutation();
      },
    );
  }

  /** Process a single message
   * @param {BoardMessage} message instruction to apply to the board
   * @returns {BoardMutationResult | ValidationFailure}
   */
  processMessage(message) {
    this.pendingRejectedMutationEffects = [];
    /** @type {BoardMutationResult | ValidationFailure} */
    let result;
    if (message._children) {
      result = this.processMessageBatch(message._children, message);
    } else {
      const id = message.id;
      switch (message.type) {
        case "delete":
          result = id ? this.delete(id) : { ok: false, reason: "missing id" };
          break;
        case "update":
          result = id
            ? this.update(id, message)
            : { ok: false, reason: "missing id" };
          break;
        case "copy":
          result = id
            ? this.copy(id, message)
            : { ok: false, reason: "missing id" };
          break;
        case "child": {
          // We don't need to store 'type', 'parent', and 'tool' for each child. They will be rehydrated from the parent on the client side
          const { parent, type, tool, ...childData } = message;
          void type;
          void tool;
          result = parent
            ? this.addChild(parent, childData)
            : { ok: false, reason: "invalid parent for child" };
          break;
        }
        case "clear":
          result = this.clear();
          break;
        default:
          //Add data
          if (id) {
            result = this.set(id, message);
            break;
          }
          logger.error("board.message_invalid", {
            message: message,
          });
          result = { ok: false, reason: "invalid message" };
          break;
      }
    }
    return result;
  }

  /** Reads data from the board
   * @param {string} id - Identifier of the element to get.
   * @returns {BoardElem | undefined} The element with the given id, or undefined if no element has this id
   */
  get(id) {
    return publicItemFromCanonicalItem(getCanonicalItem(this, id));
  }

  /** Delays the triggering of auto-save by SAVE_INTERVAL seconds */
  delaySave() {
    const config = readConfiguration();
    const delayMs = computeSaveDelayMs({
      saveIntervalMs: config.SAVE_INTERVAL,
      hasPersistedBaseline: this.hasPersistedBaseline,
      hasDirtyCreatedItems: this.dirtyCreatedIds.size > 0,
    });
    if (logger.isEnabled("debug")) {
      logger.debug(
        "board.save_scheduled",
        boardDebugFields(this, {
          "wbo.board.delay_ms": delayMs,
          "wbo.board.max_save_delay_ms": config.MAX_SAVE_DELAY,
        }),
      );
    }
    this.scheduleSaveTimeout(delayMs);
    if (Date.now() - this.lastSaveDate > config.MAX_SAVE_DELAY)
      this.scheduleSaveTimeout(0);
  }

  /**
   * @param {number} delayMs
   * @returns {void}
   */
  scheduleSaveTimeout(delayMs) {
    if (this.disposed) return;
    if (this.saveTimeoutId !== undefined) clearTimeout(this.saveTimeoutId);
    if (logger.isEnabled("debug")) {
      logger.debug(
        "board.save_timer_set",
        boardDebugFields(this, {
          "wbo.board.delay_ms": Math.max(0, delayMs),
        }),
      );
    }
    this.saveTimeoutId = setTimeout(
      () => {
        this.saveTimeoutId = undefined;
        if (this.disposed) return;
        if (logger.isEnabled("debug")) {
          logger.debug("board.save_timer_fired", boardDebugFields(this));
        }
        void this.save();
      },
      Math.max(0, delayMs),
    );
  }

  dispose() {
    if (logger.isEnabled("debug")) {
      logger.debug("board.disposed", boardDebugFields(this));
    }
    this.disposed = true;
    if (this.saveTimeoutId !== undefined) {
      clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = undefined;
    }
  }

  hasDirtyItems() {
    for (const item of this.itemsById.values()) {
      if (item.dirty === true) return true;
    }
    return false;
  }

  finalizePersistedItems(
    persistedSnapshot = this.itemsById,
    persistedIds = new Set(persistedSnapshot.keys()),
  ) {
    finalizePersistedCanonicalItems(this, persistedSnapshot, persistedIds);
  }

  /** Saves the data in the board to a file. */
  async save() {
    if (this.disposed) return;
    // The mutex prevents multiple save operation to happen simultaneously
    return this.saveMutex.runExclusive(this._unsafe_save.bind(this));
  }

  /** Save the board to disk without preventing multiple simultaneaous saves. Use save() instead */
  async _unsafe_save() {
    return tracing.withExpensiveActiveSpan(
      "board.save",
      {
        attributes: boardTraceAttributes(this.name, "save"),
        traceRoot:
          this.itemsById.size >= STANDALONE_BOARD_SAVE_ITEM_COUNT_THRESHOLD,
      },
      async () => {
        if (this.disposed) return;
        const startedAt = Date.now();
        this.lastSaveDate = Date.now();
        if (logger.isEnabled("debug")) {
          logger.debug("board.save_started", boardDebugFields(this));
        }
        this.clean();
        let savedItemsById = new Map(this.itemsById);
        let savedPaintOrder = [...this.paintOrder];
        const file = this.file;
        let authoritativeItemCount = savedPaintOrder.filter(
          (id) => savedItemsById.get(id)?.deleted !== true,
        ).length;
        if (authoritativeItemCount === 0) {
          // empty board
          try {
            await writeCanonicalBoardState(
              this.name,
              savedItemsById,
              savedPaintOrder,
              this.metadata,
              this.getSeq(),
              { historyDir: this.historyDir },
            );
            this.hasPersistedBaseline = false;
            this.markPersistedSeq(this.getSeq());
            this.trimPersistedMutationLog(startedAt);
            tracing.setActiveSpanAttributes(
              boardTraceAttributes(this.name, "save", {
                "wbo.board.result": "removed_empty",
              }),
            );
            metrics.recordBoardOperationDuration(
              "save",
              this.name,
              (Date.now() - startedAt) / 1000,
              "removed_empty",
            );
          } catch (err) {
            if (errorCode(err) !== "ENOENT") {
              // If the file already wasn't saved, this is not an error
              tracing.recordActiveSpanError(err, {
                "wbo.board.result": "error",
              });
              logger.error("board.delete_failed", {
                board: this.name,
                error: err,
              });
              metrics.recordBoardOperationDuration(
                "save",
                this.name,
                (Date.now() - startedAt) / 1000,
                err,
              );
            }
          }
        } else {
          try {
            let latestSeq = this.getSeq();
            if (this.hasPersistedBaseline) {
              if (
                this.hasDirtyItems() ||
                latestSeq !== this.getPersistedSeq()
              ) {
                let persistedIds;
                try {
                  if (logger.isEnabled("debug")) {
                    logger.debug(
                      "board.save_rewrite_started",
                      boardDebugFields(this, {
                        "wbo.board.save_target_seq": latestSeq,
                      }),
                    );
                  }
                  persistedIds = await rewriteStoredSvgFromCanonical(
                    this.name,
                    savedItemsById,
                    savedPaintOrder,
                    this.metadata,
                    this.getPersistedSeq(),
                    latestSeq,
                    { historyDir: this.historyDir },
                  );
                  this.hasPersistedBaseline = true;
                } catch (error) {
                  if (errorCode(error) !== "ENOENT") {
                    throw error;
                  }
                  logger.warn("board.save_missing_baseline", {
                    board: this.name,
                    "file.path": file,
                  });
                  const replayFromSeq =
                    this.loadSource === "empty"
                      ? this.minReplayableSeq()
                      : this.getPersistedSeq();
                  let recoveredBoard;
                  while (true) {
                    recoveredBoard = replayRecoverableMutations(
                      this,
                      replayFromSeq,
                      latestSeq,
                    );
                    const currentSeq = this.getSeq();
                    if (currentSeq === latestSeq) break;
                    latestSeq = currentSeq;
                  }
                  replaceBoardState(this, recoveredBoard);
                  if (logger.isEnabled("debug")) {
                    logger.debug(
                      "board.save_recovered_from_mutations",
                      boardDebugFields(this, {
                        "wbo.board.save_target_seq": latestSeq,
                        "wbo.board.replay_from_seq": replayFromSeq,
                      }),
                    );
                  }
                  this.hasPersistedBaseline = false;
                  latestSeq = this.getSeq();
                  savedItemsById = new Map(this.itemsById);
                  savedPaintOrder = [...this.paintOrder];
                  authoritativeItemCount = savedPaintOrder.filter(
                    (id) => savedItemsById.get(id)?.deleted !== true,
                  ).length;
                }
                if (this.hasPersistedBaseline) {
                  this.markPersistedSeq(latestSeq);
                  this.finalizePersistedItems(savedItemsById, persistedIds);
                } else {
                  const initialPersist = await writeCanonicalBoardState(
                    this.name,
                    savedItemsById,
                    savedPaintOrder,
                    this.metadata,
                    latestSeq,
                    { historyDir: this.historyDir },
                  );
                  this.hasPersistedBaseline = initialPersist.hasBaseline;
                  if (logger.isEnabled("debug")) {
                    logger.debug(
                      "board.save_initial_persist_finished",
                      boardDebugFields(this, {
                        "wbo.board.persisted_ids": [
                          ...initialPersist.persistedIds,
                        ],
                      }),
                    );
                  }
                  if (initialPersist.hasBaseline) {
                    this.markPersistedSeq(latestSeq);
                    this.finalizePersistedItems(
                      savedItemsById,
                      initialPersist.persistedIds,
                    );
                  }
                }
              } else {
                this.hasPersistedBaseline = true;
                this.markPersistedSeq(latestSeq);
                this.finalizePersistedItems(savedItemsById);
              }
            } else {
              const initialPersist = await writeCanonicalBoardState(
                this.name,
                savedItemsById,
                savedPaintOrder,
                this.metadata,
                latestSeq,
                { historyDir: this.historyDir },
              );
              this.hasPersistedBaseline = initialPersist.hasBaseline;
              if (logger.isEnabled("debug")) {
                logger.debug(
                  "board.save_initial_persist_finished",
                  boardDebugFields(this, {
                    "wbo.board.persisted_ids": [...initialPersist.persistedIds],
                  }),
                );
              }
              if (initialPersist.hasBaseline) {
                this.markPersistedSeq(latestSeq);
                this.finalizePersistedItems(
                  savedItemsById,
                  initialPersist.persistedIds,
                );
              }
            }
            if (this.hasPersistedBaseline && this.getSeq() !== latestSeq) {
              this.scheduleSaveTimeout(0);
            }
            this.trimPersistedMutationLog(startedAt);
            if (!this.hasPersistedBaseline) {
              if (logger.isEnabled("debug")) {
                logger.debug(
                  "board.save_without_baseline",
                  boardDebugFields(this),
                );
              }
              tracing.setActiveSpanAttributes(
                boardTraceAttributes(this.name, "save", {
                  "wbo.board.result": "warning",
                  "wbo.board.items": authoritativeItemCount,
                }),
              );
              metrics.recordBoardOperationDuration(
                "save",
                this.name,
                (Date.now() - startedAt) / 1000,
                "warning",
              );
              return;
            }
            let savedFile;
            try {
              savedFile = await stat(file);
            } catch (error) {
              if (errorCode(error) !== "ENOENT") {
                throw error;
              }
              try {
                savedFile = await stat(
                  boardSvgBackupPath(this.name, this.historyDir),
                );
              } catch (backupError) {
                if (
                  errorCode(backupError) !== "ENOENT" ||
                  authoritativeItemCount === 0
                ) {
                  throw backupError;
                }
                logger.warn("board.save_missing_baseline", {
                  board: this.name,
                  "file.path": file,
                });
                if (this.loadSource === "empty") {
                  const recoveredBoard = replayRecoverableMutations(
                    this,
                    this.minReplayableSeq(),
                    latestSeq,
                  );
                  replaceBoardState(this, recoveredBoard);
                  savedItemsById = new Map(this.itemsById);
                  savedPaintOrder = [...this.paintOrder];
                  authoritativeItemCount = savedPaintOrder.filter(
                    (id) => savedItemsById.get(id)?.deleted !== true,
                  ).length;
                  if (logger.isEnabled("debug")) {
                    logger.debug(
                      "board.save_recovered_from_mutations",
                      boardDebugFields(this, {
                        "wbo.board.save_target_seq": latestSeq,
                        "wbo.board.replay_from_seq": this.minReplayableSeq(),
                      }),
                    );
                  }
                }
                const initialPersist = await writeCanonicalBoardState(
                  this.name,
                  savedItemsById,
                  savedPaintOrder,
                  this.metadata,
                  latestSeq,
                  { historyDir: this.historyDir },
                );
                this.hasPersistedBaseline = initialPersist.hasBaseline;
                if (!initialPersist.hasBaseline) {
                  if (logger.isEnabled("debug")) {
                    logger.debug(
                      "board.save_without_baseline",
                      boardDebugFields(this),
                    );
                  }
                  tracing.setActiveSpanAttributes(
                    boardTraceAttributes(this.name, "save", {
                      "wbo.board.result": "warning",
                      "wbo.board.items": authoritativeItemCount,
                    }),
                  );
                  metrics.recordBoardOperationDuration(
                    "save",
                    this.name,
                    (Date.now() - startedAt) / 1000,
                    "warning",
                  );
                  return;
                }
                this.markPersistedSeq(latestSeq);
                this.finalizePersistedItems(
                  savedItemsById,
                  initialPersist.persistedIds,
                );
                savedFile = await stat(file).catch(async (persistError) => {
                  if (errorCode(persistError) !== "ENOENT") {
                    throw persistError;
                  }
                  return stat(boardSvgBackupPath(this.name, this.historyDir));
                });
              }
            }
            tracing.setActiveSpanAttributes(
              boardTraceAttributes(this.name, "save", {
                "wbo.board.result": "success",
                "file.path": file,
                "file.size": savedFile.size,
                "wbo.board.items": authoritativeItemCount,
              }),
            );
            logger.info("board.saved", {
              board: this.name,
              "file.size": savedFile.size,
              items: authoritativeItemCount,
            });
            metrics.recordBoardOperationDuration(
              "save",
              this.name,
              (Date.now() - startedAt) / 1000,
            );
          } catch (err) {
            tracing.recordActiveSpanError(err, {
              "wbo.board.result": "error",
            });
            logger.error("board.save_failed", {
              board: this.name,
              error: err,
              "file.path": file,
            });
            metrics.recordBoardOperationDuration(
              "save",
              this.name,
              (Date.now() - startedAt) / 1000,
              err,
            );
            return;
          }
        }
      },
    );
  }

  /** Remove old elements from the board */
  clean() {
    const { MAX_ITEM_COUNT } = readConfiguration();
    const ids = this.paintOrder.filter(
      (id) => this.itemsById.get(id)?.deleted !== true,
    );
    if (ids.length > MAX_ITEM_COUNT) {
      let removed = false;
      const toDestroy = ids
        .sort(
          (x, y) =>
            (this.itemsById.get(x)?.time || 0) -
            (this.itemsById.get(y)?.time || 0),
        )
        .slice(0, -MAX_ITEM_COUNT);
      for (let i = 0; i < toDestroy.length; i++) {
        const id = toDestroy[i];
        if (id !== undefined) {
          this.itemsById.delete(id);
          removed = true;
        }
      }
      if (removed) {
        this.paintOrder = this.paintOrder.filter((id) =>
          this.itemsById.has(id),
        );
        rebuildDirtyCreatedItems(this);
      }
    }
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  normalizeStoredElement(id) {
    return this.itemsById.has(id);
  }

  /** Load the data in the board from a file.
   * @param {string} name - name of the board
   */
  static async load(name) {
    const boardData = new BoardData(name);
    let traceRoot = false;
    for (const candidateFile of [
      boardData.file,
      boardJsonPath(name, boardData.historyDir),
    ]) {
      try {
        traceRoot =
          (await stat(candidateFile)).size >=
          STANDALONE_BOARD_LOAD_BYTES_THRESHOLD;
        if (traceRoot) break;
      } catch {}
    }
    return tracing.withExpensiveActiveSpan(
      "board.load",
      {
        attributes: boardTraceAttributes(name, "load"),
        traceRoot: traceRoot,
      },
      async function loadBoardData() {
        const startedAt = Date.now();
        /** @type {string} */
        const sourceFile = boardData.file;
        try {
          if (logger.isEnabled("debug")) {
            logger.debug("board.load_started", boardDebugFields(boardData));
          }
          const storedBoard = await readCanonicalBoardState(name, {
            historyDir: boardData.historyDir,
          });
          boardData.itemsById = storedBoard.itemsById;
          boardData.paintOrder = storedBoard.paintOrder;
          boardData.nextPaintOrder = storedBoard.paintOrder.reduce(
            (max, id) => {
              const item = storedBoard.itemsById.get(id);
              return item ? Math.max(max, item.paintOrder + 1) : max;
            },
            0,
          );
          rebuildDirtyCreatedItems(boardData);
          boardData.hasPersistedBaseline = storedBoard.source !== "empty";
          boardData.loadSource = storedBoard.source;
          boardData.metadata = storedBoard.metadata;
          boardData.mutationLog = createMutationLog(storedBoard.seq);
          if (logger.isEnabled("debug")) {
            logger.debug(
              "board.load_completed",
              boardDebugFields(boardData, {
                "wbo.board.load_source": storedBoard.source,
                "file.size": storedBoard.byteLength || 0,
              }),
            );
          }
          tracing.setActiveSpanAttributes(
            boardTraceAttributes(name, "load", {
              "wbo.board.result": "success",
              "file.path": sourceFile,
              "file.size": storedBoard.byteLength || 0,
              "wbo.board.items": boardData.authoritativeItemCount(),
            }),
          );
          metrics.recordBoardOperationDuration(
            "load",
            name,
            (Date.now() - startedAt) / 1000,
          );
        } catch (e) {
          // If the file doesn't exist, this is not an error
          if (errorCode(e) === "ENOENT") {
            if (logger.isEnabled("debug")) {
              logger.debug(
                "board.load_empty",
                boardDebugFields(boardData, {
                  "wbo.board.load_source": "empty",
                }),
              );
            }
            tracing.setActiveSpanAttributes(
              boardTraceAttributes(name, "load", {
                "wbo.board.result": "empty",
              }),
            );
            metrics.recordBoardOperationDuration(
              "load",
              name,
              (Date.now() - startedAt) / 1000,
              "empty",
            );
          } else {
            tracing.recordActiveSpanError(e, {
              "wbo.board.result": "error",
            });
            logger.error("board.load_failed", {
              board: name,
              error: e,
            });
            metrics.recordBoardOperationDuration(
              "load",
              name,
              (Date.now() - startedAt) / 1000,
              e,
            );
          }
          boardData.itemsById = new Map();
          boardData.paintOrder = [];
          boardData.nextPaintOrder = 0;
        }
        return boardData;
      },
    );
  }
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorCode(error) {
  if (!error || typeof error !== "object") return undefined;
  if (!("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export { BoardData };
export { computeSaveDelayMs };
