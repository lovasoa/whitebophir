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
import {
  getTool,
  getUpdatableFields,
  getMutationType,
  isShapeTool,
  MutationType,
} from "../client-data/js/message_tool_metadata.js";
import {
  canonicalItemFromItem,
  cloneCanonicalItem,
  copyCanonicalItem,
  currentText,
  effectiveChildCount,
  publicItemFromCanonicalItem,
} from "./canonical_board_items.mjs";
import { Eraser } from "../client-data/tools/index.js";
import {
  authoritativeItemCount,
  cloneBounds,
  finalizePersistedCanonicalItems,
  getCanonicalItem,
  rebuildLiveItemCount,
  removeCanonicalItem,
  upsertCanonicalItem,
} from "./board_canonical_index.mjs";
import { getMinPinnedReplayBaselineSeq } from "./board_registry.mjs";
import { boardJsonPath } from "./legacy_json_board_source.mjs";
import { createMutationLog } from "./mutation_log.mjs";
import observability from "./observability.mjs";
import { SerialTaskQueue } from "./serial_task_queue.mjs";
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

const STANDALONE_BOARD_LOAD_BYTES_THRESHOLD = 1024 * 1024;
const STANDALONE_BOARD_SAVE_ITEM_COUNT_THRESHOLD = 2048;
const STANDALONE_BOARD_BATCH_CHILD_COUNT_THRESHOLD = 64;
const boardSaveQueue = new SerialTaskQueue();
let boardInstanceSequence = 0;
/** @typedef {{minX: number, minY: number, maxX: number, maxY: number}} Bounds */
/** @typedef {{readonly: boolean}} BoardMetadata */
/** @typedef {{ok: false, reason: string}} ValidationFailure */
/** @typedef {{ok: true}} ValidationSuccess */
/** @typedef {ValidationSuccess | ValidationFailure} BoardMutationResult */
/** @typedef {{ok: true, value: BoardElem, canonical: CanonicalBoardItem, localBounds: Bounds | null}} ValidatedStoredCandidate */
/** @typedef {import("../types/app-runtime.d.ts").BoardMessage} BoardMessage */
/** @typedef {import("../types/app-runtime.d.ts").Transform} Transform */
/** @typedef {import("../types/server-runtime.d.ts").NormalizedMessageData} NormalizedMessageData */
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
 *   typeof import("./configuration.mjs"),
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
function boardLogFields(board, extras) {
  return {
    board: board.name,
    "wbo.board.instance": board.instanceId,
    "wbo.board.seq": board.getSeq(),
    "wbo.board.persisted_seq": board.getPersistedSeq(),
    "wbo.board.min_replayable_seq": board.minReplayableSeq(),
    "wbo.board.has_persisted_baseline": board.hasPersistedBaseline,
    "wbo.board.items": board.authoritativeItemCount(),
    "wbo.board.dirty_items": countDirtyItems(board),
    "wbo.board.users": board.users.size,
    "wbo.board.readonly": board.metadata.readonly,
    "file.path": board.file,
    ...(extras || {}),
  };
}

/**
 * @param {{
 *   nowMs: number,
 *   dirtyFromMs: number | null,
 *   lastWriteAtMs: number | null,
 *   saveIntervalMs: number,
 *   maxSaveDelayMs: number,
 * }} options
 * @returns {number}
 */
function computeScheduledSaveDelayMs(options) {
  if (options.dirtyFromMs === null || options.lastWriteAtMs === null) {
    return 0;
  }
  const idleDeadlineMs =
    options.lastWriteAtMs + Math.max(0, Number(options.saveIntervalMs) || 0);
  const maxDelayDeadlineMs =
    options.dirtyFromMs + Math.max(0, Number(options.maxSaveDelayMs) || 0);
  return Math.max(
    0,
    Math.min(idleDeadlineMs, maxDelayDeadlineMs) - options.nowMs,
  );
}

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
    this.file = boardFilePath(name, this.historyDir);
    /** @type {Set<string>} */
    this.persistedItemIds = new Set();
    this.dirtyFromMs = null;
    this.lastWriteAtMs = null;
    this.dirtyDuringSaveFromMs = null;
    this.saveStartedAtMs = null;
    this.saveTargetSeq = null;
    this.saveInProgress = false;
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
   * @param {number} toInclusiveSeq
   * @returns {ReturnType<ReturnType<typeof createMutationLog>["readRange"]>}
   */
  readMutationRange(fromExclusiveSeq, toInclusiveSeq) {
    return this.mutationLog.readRange(fromExclusiveSeq, toInclusiveSeq);
  }

  /**
   * @param {NormalizedMessageData} mutation
   * @param {number} [acceptedAtMs]
   * @param {string | undefined} [clientMutationId]
   * @param {string | undefined} [socketId]
   * @returns {ReturnType<ReturnType<typeof createMutationLog>["append"]>}
   */
  recordPersistentMutation(
    mutation,
    acceptedAtMs = Date.now(),
    clientMutationId,
    socketId = undefined,
  ) {
    return this.mutationLog.append({
      board: this.name,
      acceptedAtMs,
      mutation,
      clientMutationId,
      socketId,
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
    const retentionMs = Math.max(0, this.config.SEQ_REPLAY_RETENTION_MS);
    const pinnedBaselineSeq = getMinPinnedReplayBaselineSeq(this.name, nowMs);
    this.mutationLog.trimPersistedOlderThan(
      nowMs - retentionMs,
      pinnedBaselineSeq,
    );
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
    this.pendingAcceptedMutationEffects.push(...this.trimOverflowItems());
    return { ok: true };
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
    /** @type {PendingMutationEffect[]} */
    const followup = [];
    while (
      this.liveItemCount > this.maxItemCount &&
      this.trimPaintOrderIndex < this.paintOrder.length
    ) {
      const id = this.paintOrder[this.trimPaintOrderIndex];
      this.trimPaintOrderIndex += 1;
      if (id === undefined) continue;
      const item = this.itemsById.get(id);
      if (!item || item.deleted === true) continue;
      removeCanonicalItem(this, id);
      followup.push({
        mutation: eraserDeleteMutation(id),
      });
    }
    return followup;
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
    if (getMutationType(message) !== MutationType.UPDATE || !message.id) {
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
    switch (getMutationType(message)) {
      case MutationType.UPDATE:
      case MutationType.COPY:
        if (typeof message.id === "string") ids.add(message.id);
        break;
      case MutationType.APPEND:
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
    switch (getMutationType(message)) {
      case MutationType.COPY:
        if (!message.id || !getCanonicalItem(this, message.id)) {
          return { ok: false, reason: "copied object does not exist" };
        }
        return { ok: true, mutation: message };
      case MutationType.APPEND:
        if (!message.parent || !getCanonicalItem(this, message.parent)) {
          return { ok: false, reason: "invalid parent for child" };
        }
        return this.canAddChild(message.parent, message)
          ? { ok: true, mutation: message }
          : { ok: false, reason: "shape too large" };
      case MutationType.UPDATE:
        if (!message.id || !getCanonicalItem(this, message.id)) {
          return { ok: false, reason: "object not found" };
        }
        if (
          this.canUpdate(message.id, getUpdatableFields(message.tool, message))
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

  /**
   * @param {string} parentId
   * @param {BoardElem} child
   * @returns {boolean}
   */
  canAddChild(parentId, child) {
    return this.makeAppendCandidate(parentId, child).ok;
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

  /**
   * @param {BoardMessage} message
   * @returns {boolean}
   */
  canProcessMessage(message) {
    const id = message.id;
    switch (getMutationType(message)) {
      case MutationType.DELETE:
      case MutationType.CLEAR:
        return true;
      case MutationType.UPDATE:
        return id
          ? this.canUpdate(id, getUpdatableFields(message.tool, message))
          : false;
      case MutationType.COPY:
        return id ? this.canCopy(id, message) : false;
      case MutationType.APPEND:
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
            ? { ...childMessage, tool: parentMessage.tool }
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
          switch (getMutationType(message)) {
            case MutationType.CLEAR:
              clearAll = true;
              overlay.clear();
              break;
            case MutationType.DELETE:
              if (!id) return { ok: false, reason: "missing id" };
              overlay.set(id, undefined);
              break;
            case MutationType.UPDATE: {
              if (!id) return { ok: false, reason: "missing id" };
              const current = readItem(id);
              if (!current) return { ok: false, reason: "object not found" };
              const updateData = getUpdatableFields(message.tool, message);
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
            case MutationType.COPY: {
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
            case MutationType.APPEND: {
              if (!message.parent) {
                return { ok: false, reason: "invalid parent for child" };
              }
              const next = this.makeAppendCandidate(
                message.parent,
                message,
                readItem(message.parent),
              );
              if (!next.ok) return next;
              overlay.set(message.parent, next.value);
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
              const next = {
                ...validated.canonical,
                paintOrder: clearAll
                  ? this.nextPaintOrder
                  : (existing?.paintOrder ?? this.nextPaintOrder),
              };
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
          this.liveItemCount = 0;
          this.trimPaintOrderIndex = this.paintOrder.length;
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
    this.pendingAcceptedMutationEffects = [];
    /** @type {BoardMutationResult | ValidationFailure} */
    let result;
    if (message._children) {
      result = this.processMessageBatch(message._children, message);
    } else {
      const id = message.id;
      switch (getMutationType(message)) {
        case MutationType.DELETE:
          result = id ? this.delete(id) : { ok: false, reason: "missing id" };
          break;
        case MutationType.UPDATE:
          result = id
            ? this.update(id, message)
            : { ok: false, reason: "missing id" };
          break;
        case MutationType.COPY:
          result = id
            ? this.copy(id, message)
            : { ok: false, reason: "missing id" };
          break;
        case MutationType.APPEND: {
          // We don't need to store 'type', 'parent', and 'tool' for each child. They will be rehydrated from the parent on the client side
          const { parent, type, tool, ...childData } = message;
          void type;
          void tool;
          result = parent
            ? this.addChild(parent, childData)
            : { ok: false, reason: "invalid parent for child" };
          break;
        }
        case MutationType.CLEAR:
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

  clearSaveTimeout() {
    if (this.saveTimeoutId === undefined) return;
    clearTimeout(this.saveTimeoutId);
    this.saveTimeoutId = undefined;
  }

  /**
   * @param {number} [nowMs]
   * @returns {number | null}
   */
  dirtyAgeMs(nowMs = Date.now()) {
    return this.dirtyFromMs === null
      ? null
      : Math.max(0, nowMs - this.dirtyFromMs);
  }

  /** Delays the triggering of auto-save by SAVE_INTERVAL milliseconds. */
  delaySave() {
    const nowMs = Date.now();
    if (this.dirtyFromMs === null) {
      this.dirtyFromMs = nowMs;
    }
    if (this.saveInProgress && this.dirtyDuringSaveFromMs === null) {
      this.dirtyDuringSaveFromMs = nowMs;
    }
    this.lastWriteAtMs = nowMs;
    if (this.saveInProgress) return;
    this.scheduleDirtySave(nowMs);
  }

  /**
   * @param {number} [nowMs]
   * @returns {void}
   */
  scheduleDirtySave(nowMs = Date.now()) {
    const delayMs = computeScheduledSaveDelayMs({
      nowMs,
      dirtyFromMs: this.dirtyFromMs,
      lastWriteAtMs: this.lastWriteAtMs,
      saveIntervalMs: this.config.SAVE_INTERVAL,
      maxSaveDelayMs: this.config.MAX_SAVE_DELAY,
    });
    if (logger.isEnabled("debug")) {
      logger.debug(
        "board.save_scheduled",
        boardLogFields(this, {
          "wbo.board.delay_ms": delayMs,
          "wbo.board.max_save_delay_ms": this.config.MAX_SAVE_DELAY,
        }),
      );
    }
    this.scheduleSaveTimeout(delayMs);
  }

  /**
   * @param {number} delayMs
   * @returns {void}
   */
  scheduleSaveTimeout(delayMs) {
    if (
      this.disposed ||
      this.saveInProgress ||
      this.dirtyFromMs === null ||
      this.lastWriteAtMs === null
    ) {
      this.clearSaveTimeout();
      return;
    }
    this.clearSaveTimeout();
    if (logger.isEnabled("debug")) {
      logger.debug(
        "board.save_timer_set",
        boardLogFields(this, {
          "wbo.board.delay_ms": Math.max(0, delayMs),
        }),
      );
    }
    this.saveTimeoutId = setTimeout(
      () => {
        this.saveTimeoutId = undefined;
        if (this.disposed) return;
        if (logger.isEnabled("debug")) {
          logger.debug("board.save_timer_fired", boardLogFields(this));
        }
        if (this.saveInProgress) {
          return;
        }
        void this.save();
      },
      Math.max(0, delayMs),
    );
  }

  dispose() {
    if (logger.isEnabled("debug")) {
      logger.debug("board.disposed", boardLogFields(this));
    }
    this.disposed = true;
    this.clearSaveTimeout();
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
    if (this.disposed) return { status: "skipped" };
    // Persisted board writes are serialized process-wide so only one board save
    // mutates on-disk state at a time.
    return boardSaveQueue.runExclusive(this._unsafe_save.bind(this));
  }

  /** Save the board to disk without preventing multiple simultaneous saves. Use save() instead. */
  async _unsafe_save() {
    return tracing.withExpensiveActiveSpan(
      "board.save",
      {
        attributes: boardTraceAttributes(this.name, "save"),
        traceRoot:
          this.itemsById.size >= STANDALONE_BOARD_SAVE_ITEM_COUNT_THRESHOLD,
      },
      async () => {
        let shouldScheduleAfterSave = false;
        this.clearSaveTimeout();
        this.saveInProgress = true;
        this.dirtyDuringSaveFromMs = null;
        try {
          if (this.disposed) return { status: "skipped" };
          if (
            this.hasDirtyItems() !== true &&
            this.getSeq() === this.getPersistedSeq()
          ) {
            if (logger.isEnabled("debug")) {
              logger.debug("board.save_skipped", boardLogFields(this));
            }
            return { status: "skipped" };
          }
          const startedAt = Date.now();
          this.saveStartedAtMs = startedAt;
          this.saveTargetSeq = this.getSeq();
          if (logger.isEnabled("debug")) {
            logger.debug(
              "board.save_started",
              boardLogFields(this, {
                "wbo.board.save_target_seq": this.saveTargetSeq,
              }),
            );
          }
          this.clean();
          const savedItemsById = new Map(this.itemsById);
          const savedPaintOrder = [...this.paintOrder];
          const file = this.file;
          const authoritativeItemCount = savedPaintOrder.filter(
            (id) => savedItemsById.get(id)?.deleted !== true,
          ).length;
          const saveTargetSeq = this.saveTargetSeq ?? this.getSeq();
          try {
            const persistedIds =
              this.persistedItemIds.size > 0
                ? await rewriteStoredSvgFromCanonical(
                    this.name,
                    savedItemsById,
                    savedPaintOrder,
                    this.metadata,
                    this.persistedItemIds,
                    this.getPersistedSeq(),
                    saveTargetSeq,
                    { historyDir: this.historyDir },
                  )
                : (
                    await writeCanonicalBoardState(
                      this.name,
                      savedItemsById,
                      savedPaintOrder,
                      this.metadata,
                      saveTargetSeq,
                      { historyDir: this.historyDir },
                    )
                  ).persistedIds;
            this.persistedItemIds = new Set(persistedIds);
            this.markPersistedSeq(saveTargetSeq);
            this.finalizePersistedItems(savedItemsById, persistedIds);
            const savedAllSnapshotLiveItems =
              authoritativeItemCount === persistedIds.size;
            if (this.hasDirtyItems() !== true) {
              this.dirtyFromMs = null;
              this.lastWriteAtMs = null;
            } else if (
              savedAllSnapshotLiveItems &&
              this.dirtyDuringSaveFromMs !== null
            ) {
              this.dirtyFromMs = this.dirtyDuringSaveFromMs;
            }
            this.trimPersistedMutationLog(startedAt);
            const savedFile = await stat(file).catch(async (error) => {
              if (errorCode(error) !== "ENOENT") {
                throw error;
              }
              return stat(boardSvgBackupPath(this.name, this.historyDir)).catch(
                () => null,
              );
            });
            const durationMs = Date.now() - startedAt;
            tracing.setActiveSpanAttributes(
              boardTraceAttributes(this.name, "save", {
                "wbo.board.result": "success",
                ...(savedFile
                  ? {
                      "file.path": file,
                      "file.size": savedFile.size,
                    }
                  : {}),
                "wbo.board.items": authoritativeItemCount,
                "wbo.board.persisted_items": persistedIds.size,
              }),
            );
            logger.info(
              "board.saved",
              boardLogFields(this, {
                duration_ms: durationMs,
                ...(savedFile ? { "file.size": savedFile.size } : {}),
                items: authoritativeItemCount,
                "wbo.board.persisted_items": persistedIds.size,
              }),
            );
            metrics.recordBoardOperationDuration(
              "save",
              this.name,
              durationMs / 1000,
            );
            if (this.getSeq() !== saveTargetSeq) {
              shouldScheduleAfterSave = true;
            }
            return { status: "saved" };
          } catch (err) {
            const durationMs = Date.now() - startedAt;
            const code = errorCode(err);
            if (
              this.persistedItemIds.size > 0 &&
              (code === "ENOENT" || code === "WBO_STORED_SVG_SEQ_MISMATCH")
            ) {
              const actualFileSeq =
                err &&
                typeof err === "object" &&
                "actualSeq" in err &&
                typeof err.actualSeq === "number"
                  ? err.actualSeq
                  : undefined;
              const staleFields = boardLogFields(this, {
                duration_ms: durationMs,
                "wbo.board.save_target_seq": saveTargetSeq,
                "wbo.board.actual_file_seq": actualFileSeq,
                "wbo.board.dropped_local_seq_count": Math.max(
                  0,
                  this.getSeq() - this.getPersistedSeq(),
                ),
                "wbo.board.dirty_age_ms": this.dirtyAgeMs(),
                error: err,
              });
              tracing.setActiveSpanAttributes(
                boardTraceAttributes(this.name, "save", {
                  "wbo.board.result": "stale",
                  "wbo.board.save_target_seq": saveTargetSeq,
                  ...(actualFileSeq === undefined
                    ? {}
                    : { "wbo.board.actual_file_seq": actualFileSeq }),
                  "wbo.board.dropped_local_seq_count": Math.max(
                    0,
                    this.getSeq() - this.getPersistedSeq(),
                  ),
                }),
              );
              logger.warn("board.save_stale", staleFields);
              metrics.recordBoardOperationDuration(
                "save",
                this.name,
                durationMs / 1000,
                "stale",
              );
              if (typeof this.onStaleSave === "function") {
                try {
                  await this.onStaleSave({
                    actualFileSeq,
                    durationMs,
                    saveTargetSeq,
                  });
                } catch (handlerError) {
                  logger.error("board.stale_save_handler_failed", {
                    board: this.name,
                    error: handlerError,
                  });
                }
              }
              return { status: "stale" };
            }
            tracing.recordActiveSpanError(err, {
              "wbo.board.result": "error",
            });
            logger.error(
              "board.save_failed",
              boardLogFields(this, {
                duration_ms: durationMs,
                error: err,
              }),
            );
            metrics.recordBoardOperationDuration(
              "save",
              this.name,
              durationMs / 1000,
              err,
            );
            if (
              !this.disposed &&
              (this.hasDirtyItems() === true ||
                this.getSeq() !== this.getPersistedSeq())
            ) {
              shouldScheduleAfterSave = true;
            }
            return { status: "failed" };
          }
        } finally {
          this.saveInProgress = false;
          this.dirtyDuringSaveFromMs = null;
          this.saveStartedAtMs = null;
          this.saveTargetSeq = null;
          if (
            shouldScheduleAfterSave &&
            !this.disposed &&
            (this.hasDirtyItems() === true ||
              this.getSeq() !== this.getPersistedSeq())
          ) {
            this.scheduleDirtySave(Date.now());
          }
        }
      },
    );
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
    const boardData = new BoardData(name, config);
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
        try {
          if (logger.isEnabled("debug")) {
            logger.debug("board.load_started", boardLogFields(boardData));
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
          rebuildLiveItemCount(boardData);
          boardData.trimPaintOrderIndex = 0;
          boardData.persistedItemIds = new Set(storedBoard.itemsById.keys());
          boardData.dirtyFromMs = null;
          boardData.lastWriteAtMs = null;
          boardData.dirtyDuringSaveFromMs = null;
          boardData.saveStartedAtMs = null;
          boardData.saveTargetSeq = null;
          boardData.loadSource = storedBoard.source;
          boardData.metadata = storedBoard.metadata;
          boardData.mutationLog = createMutationLog(storedBoard.seq);
          if (logger.isEnabled("debug")) {
            logger.debug(
              "board.load_completed",
              boardLogFields(boardData, {
                "wbo.board.load_source": storedBoard.source,
                "file.size": storedBoard.byteLength || 0,
              }),
            );
          }
          const durationMs = Date.now() - startedAt;
          logger.info(
            "board.loaded",
            boardLogFields(boardData, {
              duration_ms: durationMs,
              "wbo.board.load_source": storedBoard.source,
              "wbo.board.paint_order_entries": boardData.paintOrder.length,
              "file.size": storedBoard.byteLength || 0,
              items: boardData.authoritativeItemCount(),
            }),
          );
          tracing.setActiveSpanAttributes(
            boardTraceAttributes(name, "load", {
              "wbo.board.result": "success",
              "file.path": boardData.file,
              "file.size": storedBoard.byteLength || 0,
              "wbo.board.items": boardData.authoritativeItemCount(),
            }),
          );
          metrics.recordBoardOperationDuration("load", name, durationMs / 1000);
        } catch (e) {
          // If the file doesn't exist, this is not an error
          if (errorCode(e) === "ENOENT") {
            if (logger.isEnabled("debug")) {
              logger.debug(
                "board.load_empty",
                boardLogFields(boardData, {
                  "wbo.board.load_source": "empty",
                }),
              );
            }
            const durationMs = Date.now() - startedAt;
            logger.info(
              "board.loaded",
              boardLogFields(boardData, {
                duration_ms: durationMs,
                "wbo.board.load_source": "empty",
                "wbo.board.result": "empty",
                items: 0,
              }),
            );
            tracing.setActiveSpanAttributes(
              boardTraceAttributes(name, "load", {
                "wbo.board.result": "empty",
              }),
            );
            metrics.recordBoardOperationDuration(
              "load",
              name,
              durationMs / 1000,
              "empty",
            );
          } else {
            const durationMs = Date.now() - startedAt;
            tracing.recordActiveSpanError(e, {
              "wbo.board.result": "error",
            });
            logger.error(
              "board.load_failed",
              boardLogFields(boardData, {
                duration_ms: durationMs,
                error: e,
              }),
            );
            metrics.recordBoardOperationDuration(
              "load",
              name,
              durationMs / 1000,
              e,
            );
          }
          boardData.itemsById = new Map();
          boardData.paintOrder = [];
          boardData.nextPaintOrder = 0;
          boardData.persistedItemIds = new Set();
          boardData.dirtyFromMs = null;
          boardData.lastWriteAtMs = null;
          boardData.dirtyDuringSaveFromMs = null;
          boardData.saveStartedAtMs = null;
          boardData.saveTargetSeq = null;
          boardData.liveItemCount = 0;
          boardData.trimPaintOrderIndex = 0;
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
export { computeScheduledSaveDelayMs };
