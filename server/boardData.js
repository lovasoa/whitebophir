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

var nativeFs = require("node:fs"),
  { readFile, rename, unlink, writeFile } = require("node:fs/promises"),
  { logger, metrics, tracing } = require("./observability.js"),
  MessageToolMetadata = require("../client-data/js/message_tool_metadata.js"),
  {
    normalizeStoredChildPoint,
    normalizeStoredItemWithBounds,
  } = require("./message_validation.js"),
  MessageCommon = require("../client-data/js/message_common.js"),
  path = require("node:path"),
  config = require("./configuration.js");

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

const BOARD_METADATA_KEY = "__wbo_meta__";
/** @typedef {{minX: number, minY: number, maxX: number, maxY: number}} Bounds */
/** @typedef {{readonly: boolean}} BoardMetadata */
/** @typedef {{ok: false, reason: string}} ValidationFailure */
/** @typedef {{ok: true}} ValidationSuccess */
/** @typedef {ValidationSuccess | ValidationFailure} BoardMutationResult */
/** @typedef {{ok: true, value: BoardElem, localBounds: Bounds | null}} ValidatedStoredCandidate */
/** @typedef {import("../types/app-runtime").BoardMessage} BoardMessage */

/** @returns {BoardMetadata} */
function defaultBoardMetadata() {
  return {
    readonly: false,
  };
}

/**
 * @param {any} metadata
 * @returns {BoardMetadata}
 */
function normalizeBoardMetadata(metadata) {
  return {
    readonly: metadata && metadata.readonly === true,
  };
}

/**
 * @param {string} name
 * @returns {string}
 */
function boardFilePath(name) {
  return path.join(
    config.HISTORY_DIR,
    `board-${encodeURIComponent(name)}.json`,
  );
}

/**
 * @param {any} storedBoard
 * @returns {{board: {[name: string]: BoardElem}, metadata: BoardMetadata}}
 */
function parseStoredBoard(storedBoard) {
  if (
    !storedBoard ||
    typeof storedBoard !== "object" ||
    Array.isArray(storedBoard)
  ) {
    throw new Error("Invalid board file format");
  }

  /** @type {{[name: string]: BoardElem}} */
  var board = {};
  var metadata = defaultBoardMetadata();

  for (const [key, value] of Object.entries(storedBoard)) {
    if (key === BOARD_METADATA_KEY) {
      metadata = normalizeBoardMetadata(value);
    } else {
      board[key] = value;
    }
  }

  return { board, metadata };
}

/**
 * @param {{[name: string]: BoardElem}} board
 * @param {BoardMetadata} metadata
 * @returns {{[name: string]: BoardElem | BoardMetadata}}
 */
function serializeStoredBoard(board, metadata) {
  var storedBoard = Object.assign({}, board);
  if (metadata?.readonly) {
    storedBoard[BOARD_METADATA_KEY] = { readonly: true };
  }
  return storedBoard;
}

/**
 * @param {string} boardName
 * @param {string} operation
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function boardTraceAttributes(boardName, operation, extras) {
  return Object.assign(
    {
      "wbo.board": boardName,
      "wbo.board.operation": operation,
    },
    extras,
  );
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
 * Represents a board.
 * @typedef {{[object_id:string]: any}} BoardElem
 */
class BoardData {
  /**
   * @param {string} name
   */
  constructor(name) {
    this.name = name;
    /** @type {{[name: string]: BoardElem}} */
    this.board = {};
    this.metadata = defaultBoardMetadata();
    this.file = boardFilePath(name);
    this.lastSaveDate = Date.now();
    this.users = new Set();
    this.saveMutex = new SerialTaskQueue();
    this.localBoundsCache = new Map();
    this.revision = 0;
  }

  isReadOnly() {
    return this.metadata.readonly === true;
  }

  /**
   * @returns {number}
   */
  getRevision() {
    return this.revision;
  }

  /**
   * @returns {{ok: true, revision: number}}
   */
  commitMutation() {
    this.revision += 1;
    return { ok: true, revision: this.revision };
  }

  /**
   * @param {Bounds | null | undefined} bounds
   * @returns {Bounds | null}
   */
  cloneBounds(bounds) {
    return bounds
      ? {
          minX: bounds.minX,
          minY: bounds.minY,
          maxX: bounds.maxX,
          maxY: bounds.maxY,
        }
      : null;
  }

  /**
   * @param {string} id
   * @param {Bounds | null | undefined} bounds
   * @returns {void}
   */
  cacheLocalBounds(id, bounds) {
    if (bounds) {
      this.localBoundsCache.set(id, this.cloneBounds(bounds));
    } else {
      this.localBoundsCache.delete(id);
    }
  }

  /**
   * @param {string} id
   * @param {BoardElem} [item]
   * @returns {Bounds | null}
   */
  getLocalBounds(id, item) {
    const target = item || this.board[id];
    if (!target) return null;

    const cachedBounds = this.localBoundsCache.get(id);
    if (cachedBounds) return this.cloneBounds(cachedBounds);

    const bounds = MessageCommon.getLocalGeometryBounds(target);
    this.cacheLocalBounds(id, bounds);
    return bounds;
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
    const obj = this.board[id];
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

    const candidate = Object.assign({}, base, updateData);
    const localBounds =
      base.tool === "Pencil" && updateData.transform !== undefined
        ? this.getLocalBounds(id, base)
        : MessageCommon.getLocalGeometryBounds(candidate);
    return { value: candidate, localBounds };
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
      const candidate = Object.assign({}, obj, { txt: updateData.txt });
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
    const obj = this.board[parentId];
    if (!obj || obj.tool !== "Pencil") return false;

    const normalizedChild = normalizeStoredChildPoint(child);
    if (!normalizedChild.ok) return false;
    if (
      Array.isArray(obj._children) &&
      obj._children.length >= config.MAX_CHILDREN
    )
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
    const obj = this.board[id];
    if (!obj) return false;
    return this.validateStoredCandidate(data.newid, structuredClone(obj)).ok;
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
    this.board[id] = validated.value;
    this.cacheLocalBounds(id, validated.localBounds);
    this.delaySave();
    return this.commitMutation();
  }

  /** Adds a child to an element that is already in the board
   * @param {string} parentId - Identifier of the parent element.
   * @param {BoardElem} child - Object containing the the values to update.
   * @returns {BoardMutationResult | ValidationFailure} - True if the child was added, else false
   */
  addChild(parentId, child) {
    var obj = this.board[parentId];
    if (typeof obj !== "object" || obj.tool !== "Pencil")
      return { ok: false, reason: "invalid parent for child" };
    const normalizedChild = normalizeStoredChildPoint(child);
    if (!normalizedChild.ok) return normalizedChild;
    const children = Array.isArray(obj._children) ? obj._children : [];
    if (children.length >= config.MAX_CHILDREN)
      return { ok: false, reason: "too many children" };
    const nextBounds = MessageCommon.extendBoundsWithPoint(
      this.getLocalBounds(parentId, obj),
      normalizedChild.value.x,
      normalizedChild.value.y,
    );
    if (this.isCandidateTooLarge(obj, nextBounds))
      return { ok: false, reason: "shape too large" };
    if (!Array.isArray(obj._children)) obj._children = children;
    obj._children.push(normalizedChild.value);
    this.cacheLocalBounds(parentId, nextBounds);
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
    var tool = data.tool;
    var updateData = filterUpdatableFields(tool, data);

    var obj = this.board[id];
    if (typeof obj !== "object")
      return { ok: false, reason: "object not found" };
    if (!this.canUpdate(id, updateData)) {
      if (this.shouldDropSeedShapeOnRejectedUpdate(obj.tool, obj, id)) {
        delete this.board[id];
        this.localBoundsCache.delete(id);
      }
      return { ok: false, reason: "update rejected: shape too large" };
    }
    for (var i in updateData) {
      if (updateData[i] !== undefined) obj[i] = updateData[i];
    }
    const nextLocalBounds =
      obj.tool === "Pencil" && updateData.transform !== undefined
        ? this.getLocalBounds(id, obj)
        : MessageCommon.getLocalGeometryBounds(obj);
    this.cacheLocalBounds(id, nextLocalBounds);
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
    this.board[id] = item;
    this.cacheLocalBounds(id, localBounds);
  }

  /** Copy elements in the board
   * @param {string} id - Identifier of the data to copy.
   * @param {BoardElem} data - Object containing the id of the new copied element.
   * @returns {BoardMutationResult | ValidationFailure}
   */
  copy(id, data) {
    var obj = this.board[id];
    var newid = data.newid;
    if (obj) {
      const newobj = structuredClone(obj);
      const validated = this.validateStoredCandidate(newid, newobj);
      if (!validated.ok) return validated;
      this.board[newid] = validated.value;
      this.cacheLocalBounds(newid, validated.localBounds);
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
    this.board = {};
    this.localBoundsCache.clear();
    this.delaySave();
    return this.commitMutation();
  }

  /** Removes data from the board
   * @param {string} id - Identifier of the data to delete.
   * @returns {ValidationSuccess}
   */
  delete(id) {
    //KISS
    delete this.board[id];
    this.localBoundsCache.delete(id);
    this.delaySave();
    return this.commitMutation();
  }

  /** Process a batch of messages
   * @param {BoardMessage[]} children array of messages to be delegated to the other methods
   * @param {BoardMessage} [parentMessage]
   * @returns {BoardMutationResult | ValidationFailure}
   */
  processMessageBatch(children, parentMessage) {
    const messages = children.map((childMessage) =>
      parentMessage && childMessage.tool === undefined
        ? Object.assign({ tool: parentMessage.tool }, childMessage)
        : childMessage,
    );

    let boardCleared = false;
    /** @type {Map<string, BoardElem | undefined>} */
    const shadowItems = new Map();
    /** @type {Map<string, Bounds | null | undefined>} */
    const shadowLocalBounds = new Map();
    /** @type {Array<{type: "clear"} | {type: "delete", id: string} | {type: "replace", id: string, item: BoardElem, localBounds: Bounds | null}>} */
    const actions = [];
    /**
     * @param {string} id
     * @returns {BoardElem | undefined}
     */
    const readShadowItem = (id) =>
      shadowItems.has(id)
        ? shadowItems.get(id)
        : boardCleared
          ? undefined
          : this.board[id];
    /**
     * @param {string} id
     * @param {BoardElem} item
     * @returns {Bounds | null}
     */
    const readShadowLocalBounds = (id, item) => {
      if (shadowLocalBounds.has(id)) {
        return this.cloneBounds(shadowLocalBounds.get(id));
      }
      if (boardCleared) return null;
      return this.getLocalBounds(id, item);
    };

    for (const message of messages) {
      const id = message.id;
      switch (message.type) {
        case "clear":
          boardCleared = true;
          shadowItems.clear();
          shadowLocalBounds.clear();
          actions.push({ type: "clear" });
          break;
        case "delete":
          if (!id) return { ok: false, reason: "missing id" };
          shadowItems.set(id, undefined);
          shadowLocalBounds.set(id, undefined);
          actions.push({ type: "delete", id: id });
          break;
        case "update": {
          if (!id) return { ok: false, reason: "missing id" };
          const current = readShadowItem(id);
          if (typeof current !== "object")
            return { ok: false, reason: "object not found" };
          const updateData = filterUpdatableFields(message.tool, message);
          const candidateData = this.makeUpdateCandidate(
            id,
            current,
            updateData,
          );
          if (!candidateData) return { ok: false, reason: "object not found" };
          const candidate = candidateData.value;
          const localBounds = candidateData.localBounds;
          if (this.isCandidateTooLarge(candidate, localBounds))
            return { ok: false, reason: "shape too large" };
          shadowItems.set(id, candidate);
          shadowLocalBounds.set(id, this.cloneBounds(localBounds));
          actions.push({
            type: "replace",
            id: id,
            item: candidate,
            localBounds: localBounds,
          });
          break;
        }
        case "copy": {
          if (!id || !message.newid) return { ok: false, reason: "missing id" };
          const current = readShadowItem(id);
          if (!current)
            return { ok: false, reason: "copied object does not exist" };
          const validated = this.validateStoredCandidate(
            message.newid,
            structuredClone(current),
          );
          if (!validated.ok) return validated;
          shadowItems.set(message.newid, validated.value);
          shadowLocalBounds.set(
            message.newid,
            this.cloneBounds(validated.localBounds),
          );
          actions.push({
            type: "replace",
            id: message.newid,
            item: validated.value,
            localBounds: validated.localBounds,
          });
          break;
        }
        case "child": {
          if (!message.parent)
            return { ok: false, reason: "invalid parent for child" };
          const current = readShadowItem(message.parent);
          if (!current || current.tool !== "Pencil")
            return { ok: false, reason: "invalid parent for child" };
          const normalizedChild = normalizeStoredChildPoint(message);
          if (!normalizedChild.ok) return normalizedChild;
          const currentChildren = Array.isArray(current._children)
            ? current._children.slice()
            : [];
          if (currentChildren.length >= config.MAX_CHILDREN)
            return { ok: false, reason: "too many children" };
          const nextBounds = MessageCommon.extendBoundsWithPoint(
            readShadowLocalBounds(message.parent, current),
            normalizedChild.value.x,
            normalizedChild.value.y,
          );
          if (this.isCandidateTooLarge(current, nextBounds))
            return { ok: false, reason: "shape too large" };
          currentChildren.push(normalizedChild.value);
          const candidate = Object.assign({}, current, {
            _children: currentChildren,
          });
          shadowItems.set(message.parent, candidate);
          shadowLocalBounds.set(message.parent, this.cloneBounds(nextBounds));
          actions.push({
            type: "replace",
            id: message.parent,
            item: candidate,
            localBounds: nextBounds,
          });
          break;
        }
        default: {
          if (!id) return { ok: false, reason: "missing id" };
          message.time = Date.now();
          const validated = this.validateStoredCandidate(id, message);
          if (!validated.ok) return validated;
          shadowItems.set(id, validated.value);
          shadowLocalBounds.set(id, this.cloneBounds(validated.localBounds));
          actions.push({
            type: "replace",
            id: id,
            item: validated.value,
            localBounds: validated.localBounds,
          });
          break;
        }
      }
    }

    for (const action of actions) {
      switch (action.type) {
        case "clear":
          this.board = {};
          this.localBoundsCache.clear();
          break;
        case "delete":
          delete this.board[action.id];
          this.localBoundsCache.delete(action.id);
          break;
        case "replace":
          this.replaceItem(action.id, action.item, action.localBounds);
          break;
      }
    }
    if (actions.length > 0) this.delaySave();
    return this.commitMutation();
  }

  /** Process a single message
   * @param {BoardMessage} message instruction to apply to the board
   * @returns {BoardMutationResult | ValidationFailure}
   */
  processMessage(message) {
    if (message._children)
      return this.processMessageBatch(message._children, message);
    const id = message.id;
    switch (message.type) {
      case "delete":
        return id ? this.delete(id) : { ok: false, reason: "missing id" };
      case "update":
        return id
          ? this.update(id, message)
          : { ok: false, reason: "missing id" };
      case "copy":
        return id
          ? this.copy(id, message)
          : { ok: false, reason: "missing id" };
      case "child": {
        // We don't need to store 'type', 'parent', and 'tool' for each child. They will be rehydrated from the parent on the client side
        const { parent, type, tool, ...childData } = message;
        return parent
          ? this.addChild(parent, childData)
          : { ok: false, reason: "invalid parent for child" };
      }
      case "clear":
        return this.clear();
      default:
        //Add data
        if (id) return this.set(id, message);
        logger.error("board.message_invalid", {
          message: message,
        });
        return { ok: false, reason: "invalid message" };
    }
  }

  /** Reads data from the board
   * @param {string} id - Identifier of the element to get.
   * @returns {BoardElem | undefined} The element with the given id, or undefined if no element has this id
   */
  get(id) {
    return this.board[id];
  }

  /** Reads data from the board
   * @param {string} [id] - Identifier of the first element to get.
   * @returns {BoardElem[]}
   */
  getAll(id) {
    return Object.entries(this.board)
      .filter(([i]) => !id || i > id)
      .map(([_, elem]) => elem);
  }

  /** Delays the triggering of auto-save by SAVE_INTERVAL seconds */
  delaySave() {
    if (this.saveTimeoutId !== undefined) clearTimeout(this.saveTimeoutId);
    this.saveTimeoutId = setTimeout(this.save.bind(this), config.SAVE_INTERVAL);
    if (Date.now() - this.lastSaveDate > config.MAX_SAVE_DELAY)
      setTimeout(this.save.bind(this), 0);
  }

  /** Saves the data in the board to a file. */
  async save() {
    // The mutex prevents multiple save operation to happen simultaneously
    return this.saveMutex.runExclusive(this._unsafe_save.bind(this));
  }

  /** Save the board to disk without preventing multiple simultaneaous saves. Use save() instead */
  async _unsafe_save() {
    return tracing.withOptionalActiveSpan(
      "board.save",
      {
        attributes: boardTraceAttributes(this.name, "save"),
      },
      async () => {
        this.lastSaveDate = Date.now();
        this.clean();
        var file = this.file;
        var tmp_file = backupFileName(file);
        var storedBoard = serializeStoredBoard(this.board, this.metadata);
        var board_txt = JSON.stringify(storedBoard);
        if (board_txt === "{}") {
          // empty board
          try {
            await unlink(file);
            tracing.setActiveSpanAttributes(
              boardTraceAttributes(this.name, "save", {
                "wbo.board.result": "removed_empty",
              }),
            );
            metrics.recordBoardOperation("save", "removed_empty");
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
              metrics.recordBoardOperation("save", "error");
            }
          }
        } else {
          try {
            await writeFile(tmp_file, board_txt, { flag: "wx" });
            await rename(tmp_file, file);
            tracing.setActiveSpanAttributes(
              boardTraceAttributes(this.name, "save", {
                "wbo.board.result": "success",
                "file.path": file,
                "file.size": board_txt.length,
                "wbo.board.items": Object.keys(this.board).length,
              }),
            );
            logger.info("board.saved", {
              board: this.name,
              "file.size": board_txt.length,
              items: Object.keys(this.board).length,
            });
            metrics.recordBoardOperation("save", "success");
          } catch (err) {
            tracing.recordActiveSpanError(err, {
              "wbo.board.result": "error",
            });
            logger.error("board.save_failed", {
              board: this.name,
              error: err,
              "file.path": tmp_file,
            });
            metrics.recordBoardOperation("save", "error");
            return;
          }
        }
      },
    );
  }

  /** Remove old elements from the board */
  clean() {
    var board = this.board;
    var ids = Object.keys(board);
    if (ids.length > config.MAX_ITEM_COUNT) {
      const toDestroy = ids
        .sort((x, y) => (board[x]?.time | 0) - (board[y]?.time | 0))
        .slice(0, -config.MAX_ITEM_COUNT);
      for (let i = 0; i < toDestroy.length; i++) {
        const id = toDestroy[i];
        if (id !== undefined) delete board[id];
      }
      metrics.recordBoardOperation("clean", "success");
    }
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  normalizeStoredElement(id) {
    const existing = this.board[id];
    if (existing === undefined) {
      this.localBoundsCache.delete(id);
      return false;
    }
    const validated = this.validateStoredCandidate(id, existing);
    if (!validated.ok) {
      delete this.board[id];
      this.localBoundsCache.delete(id);
      return false;
    }

    this.board[id] = validated.value;
    this.cacheLocalBounds(id, validated.localBounds);
    return true;
  }

  /** Load the data in the board from a file.
   * @param {string} name - name of the board
   */
  static async load(name) {
    return tracing.withOptionalActiveSpan(
      "board.load",
      {
        attributes: boardTraceAttributes(name, "load"),
      },
      async function loadBoardData() {
        var boardData = new BoardData(name);
        /** @type {string | undefined} */
        var data;
        try {
          data = await readFile(boardData.file, "utf8");
          const storedBoard = parseStoredBoard(JSON.parse(data));
          boardData.board = storedBoard.board;
          boardData.metadata = storedBoard.metadata;
          for (const id of Object.keys(boardData.board)) {
            boardData.normalizeStoredElement(id);
          }
          tracing.setActiveSpanAttributes(
            boardTraceAttributes(name, "load", {
              "wbo.board.result": "success",
              "file.path": boardData.file,
              "file.size": data.length,
              "wbo.board.items": Object.keys(boardData.board).length,
            }),
          );
          metrics.recordBoardOperation("load", "success");
        } catch (e) {
          // If the file doesn't exist, this is not an error
          if (errorCode(e) === "ENOENT") {
            tracing.setActiveSpanAttributes(
              boardTraceAttributes(name, "load", {
                "wbo.board.result": "empty",
              }),
            );
            metrics.recordBoardOperation("load", "empty");
          } else {
            tracing.recordActiveSpanError(e, {
              "wbo.board.result": "error",
            });
            logger.error("board.load_failed", {
              board: name,
              error: e,
            });
            metrics.recordBoardOperation("load", "error");
          }
          boardData.board = {};
          const backupData = data;
          if (backupData !== undefined) {
            // There was an error loading the board, but some data was still read
            const backup = backupFileName(boardData.file);
            logger.warn("board.backup_created", {
              board: boardData.name,
              "file.path": backup,
            });
            await tracing.withOptionalActiveSpan(
              "board.backup_write",
              {
                attributes: boardTraceAttributes(
                  boardData.name,
                  "backup_write",
                  {
                    "wbo.board.result": "backup_created",
                  },
                ),
              },
              async function writeBoardBackup() {
                try {
                  await writeFile(backup, backupData);
                } catch (err) {
                  tracing.recordActiveSpanError(err, {
                    "wbo.board.result": "error",
                  });
                  logger.error("board.backup_failed", {
                    board: boardData.name,
                    "file.path": backup,
                    error: err,
                  });
                }
              },
            );
          }
        }
        return boardData;
      },
    );
  }

  /**
   * @param {string} name
   * @returns {BoardMetadata}
   */
  static loadMetadataSync(name) {
    return tracing.withOptionalActiveSpan(
      "board.metadata_load",
      {
        attributes: boardTraceAttributes(name, "metadata_load"),
      },
      function loadBoardMetadata() {
        const metadata = defaultBoardMetadata();
        try {
          const data = nativeFs.readFileSync(boardFilePath(name), {
            encoding: "utf8",
          });
          return parseStoredBoard(JSON.parse(data)).metadata;
        } catch (err) {
          if (errorCode(err) !== "ENOENT") {
            tracing.recordActiveSpanError(err, {
              "wbo.board.result": "error",
            });
            logger.error("board.metadata_load_failed", {
              board: name,
              error: err,
            });
          }
          return metadata;
        }
      },
    );
  }
}

/**
 * Given a board file name, return a name to use for temporary data saving.
 * @param {string} baseName
 */
function backupFileName(baseName) {
  var date = new Date().toISOString().replace(/:/g, "");
  return `${baseName}.${date}.bak`;
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

module.exports = {
  BoardData,
  BOARD_METADATA_KEY,
  parseStoredBoard,
};
