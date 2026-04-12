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
  log = require("./log.js").log,
  {
    normalizeStoredChildPoint,
    normalizeStoredItem,
  } = require("./message_validation.js"),
  MessageCommon = require("../client-data/js/message_common.js"),
  path = require("node:path"),
  config = require("./configuration.js"),
  Mutex = require("async-mutex").Mutex;

const BOARD_METADATA_KEY = "__wbo_meta__";

function defaultBoardMetadata() {
  return {
    readonly: false,
  };
}

function normalizeBoardMetadata(metadata) {
  return {
    readonly: metadata && metadata.readonly === true,
  };
}

function boardFilePath(name) {
  return path.join(
    config.HISTORY_DIR,
    "board-" + encodeURIComponent(name) + ".json",
  );
}

function parseStoredBoard(storedBoard) {
  if (
    !storedBoard ||
    typeof storedBoard !== "object" ||
    Array.isArray(storedBoard)
  ) {
    throw new Error("Invalid board file format");
  }

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

function serializeStoredBoard(board, metadata) {
  var storedBoard = Object.assign({}, board);
  if (metadata && metadata.readonly) {
    storedBoard[BOARD_METADATA_KEY] = { readonly: true };
  }
  return storedBoard;
}

function filterUpdatableFields(tool, data) {
  switch (tool) {
    case "Straight line":
      return {
        x2: data.x2,
        y2: data.y2,
      };
    case "Rectangle":
    case "Ellipse":
      return {
        x: data.x,
        y: data.y,
        x2: data.x2,
        y2: data.y2,
      };
    case "Text":
      return {
        txt: data.txt,
      };
    case "Hand":
      return {
        transform: data.transform,
      };
    default:
      return {};
  }
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
    this.saveMutex = new Mutex();
    this.localBoundsCache = new Map();
  }

  isReadOnly() {
    return this.metadata.readonly === true;
  }

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

  cacheLocalBounds(id, bounds) {
    if (bounds) {
      this.localBoundsCache.set(id, this.cloneBounds(bounds));
    } else {
      this.localBoundsCache.delete(id);
    }
  }

  getLocalBounds(id, item) {
    const target = item || this.board[id];
    if (!target) return null;

    const cachedBounds = this.localBoundsCache.get(id);
    if (cachedBounds) return this.cloneBounds(cachedBounds);

    const bounds = MessageCommon.getLocalGeometryBounds(target);
    this.cacheLocalBounds(id, bounds);
    return bounds;
  }

  validateStoredCandidate(id, data) {
    const normalized = normalizeStoredItem(data, id);
    if (!normalized.ok) return normalized;
    return {
      ok: true,
      value: normalized.value,
      localBounds: MessageCommon.getLocalGeometryBounds(normalized.value),
    };
  }

  isCandidateTooLarge(candidate, localBounds) {
    const effectiveBounds = MessageCommon.applyTransformToBounds(
      localBounds,
      candidate && candidate.transform,
    );
    return MessageCommon.isBoundsTooLarge(effectiveBounds);
  }

  hasZeroLocalExtent(item, id) {
    const bounds = this.getLocalBounds(id, item);
    if (!bounds) return false;
    return bounds.minX === bounds.maxX && bounds.minY === bounds.maxY;
  }

  shouldDropSeedShapeOnRejectedUpdate(tool, item, id) {
    return (
      (tool === "Straight line" ||
        tool === "Rectangle" ||
        tool === "Ellipse") &&
      item &&
      item.tool === tool &&
      this.hasZeroLocalExtent(item, id) &&
      item.transform === undefined
    );
  }

  canStore(id, data) {
    return this.validateStoredCandidate(id, data).ok;
  }

  canUpdate(id, updateData) {
    const obj = this.board[id];
    if (typeof obj !== "object") return false;

    const candidate = Object.assign({}, obj, updateData);
    const localBounds =
      obj.tool === "Pencil" && updateData.transform !== undefined
        ? this.getLocalBounds(id, obj)
        : MessageCommon.getLocalGeometryBounds(candidate);
    return !this.isCandidateTooLarge(candidate, localBounds);
  }

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

  canCopy(id, data) {
    const obj = this.board[id];
    if (!obj) return false;
    return this.validateStoredCandidate(data.newid, structuredClone(obj)).ok;
  }

  canProcessMessage(message) {
    let id = message.id;
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
        return this.canAddChild(message.parent, message);
      default:
        return id ? this.canStore(id, message) : false;
    }
  }

  /** Adds data to the board
   * @param {string} id
   * @param {BoardElem} data
   */
  set(id, data) {
    //KISS
    data.time = Date.now();
    const validated = this.validateStoredCandidate(id, data);
    if (!validated.ok) return false;
    this.board[id] = validated.value;
    this.cacheLocalBounds(id, validated.localBounds);
    this.delaySave();
    return true;
  }

  /** Adds a child to an element that is already in the board
   * @param {string} parentId - Identifier of the parent element.
   * @param {BoardElem} child - Object containing the the values to update.
   * @returns {boolean} - True if the child was added, else false
   */
  addChild(parentId, child) {
    var obj = this.board[parentId];
    if (typeof obj !== "object" || obj.tool !== "Pencil") return false;
    const normalizedChild = normalizeStoredChildPoint(child);
    if (!normalizedChild.ok) return false;
    const children = Array.isArray(obj._children) ? obj._children : [];
    if (children.length >= config.MAX_CHILDREN) return false;
    const nextBounds = MessageCommon.extendBoundsWithPoint(
      this.getLocalBounds(parentId, obj),
      normalizedChild.value.x,
      normalizedChild.value.y,
    );
    if (this.isCandidateTooLarge(obj, nextBounds)) return false;
    if (!Array.isArray(obj._children)) obj._children = children;
    obj._children.push(normalizedChild.value);
    this.cacheLocalBounds(parentId, nextBounds);
    this.delaySave();
    return true;
  }

  /** Update the data in the board
   * @param {string} id - Identifier of the data to update.
   * @param {BoardElem} data - Object containing the values to update.
   * @param {boolean} create - True if the object should be created if it's not currently in the DB.
   */
  update(id, data, create) {
    var tool = data.tool;
    var updateData = filterUpdatableFields(tool, data);

    var obj = this.board[id];
    if (typeof obj !== "object") return false;
    if (!this.canUpdate(id, updateData)) {
      if (this.shouldDropSeedShapeOnRejectedUpdate(obj.tool, obj, id)) {
        delete this.board[id];
        this.localBoundsCache.delete(id);
      }
      return false;
    }
    for (var i in updateData) {
      if (updateData[i] !== undefined) obj[i] = updateData[i];
    }
    this.cacheLocalBounds(id, MessageCommon.getLocalGeometryBounds(obj));
    this.delaySave();
    return true;
  }

  /** Copy elements in the board
   * @param {string} id - Identifier of the data to copy.
   * @param {BoardElem} data - Object containing the id of the new copied element.
   */
  copy(id, data) {
    var obj = this.board[id];
    var newid = data.newid;
    if (obj) {
      var newobj = structuredClone(obj);
      const validated = this.validateStoredCandidate(newid, newobj);
      if (!validated.ok) return false;
      this.board[newid] = validated.value;
      this.cacheLocalBounds(newid, validated.localBounds);
    } else {
      log("Copied object does not exist in board.", { object: id });
      return false;
    }
    this.delaySave();
    return true;
  }

  /** Clear the board of all data
   */
  clear() {
    this.board = {};
    this.localBoundsCache.clear();
    this.delaySave();
    return true;
  }

  /** Removes data from the board
   * @param {string} id - Identifier of the data to delete.
   */
  delete(id) {
    //KISS
    delete this.board[id];
    this.localBoundsCache.delete(id);
    this.delaySave();
    return true;
  }

  /** Process a batch of messages
   * @typedef {{
   *  id:string,
   *  type: "delete" | "update" | "child",
   *  parent?: string,
   *  _children?: BoardMessage[],
   * } & BoardElem } BoardMessage
   * @param {BoardMessage[]} children array of messages to be delegated to the other methods
   */
  processMessageBatch(children, parentMessage) {
    const messages = children.map((childMessage) =>
      parentMessage && childMessage.tool === undefined
        ? Object.assign({ tool: parentMessage.tool }, childMessage)
        : childMessage,
    );

    let boardCleared = false;
    const shadowItems = new Map();
    const readShadowItem = (id) =>
      shadowItems.has(id)
        ? shadowItems.get(id)
        : boardCleared
          ? undefined
          : this.board[id];

    for (const message of messages) {
      const id = message.id;
      switch (message.type) {
        case "clear":
          boardCleared = true;
          shadowItems.clear();
          break;
        case "delete":
          if (id) shadowItems.set(id, undefined);
          break;
        case "update": {
          if (!id) return false;
          const current = readShadowItem(id);
          if (typeof current !== "object") return false;
          const updateData = filterUpdatableFields(message.tool, message);
          const candidate = Object.assign({}, current, updateData);
          const localBounds =
            current.tool === "Pencil" && updateData.transform !== undefined
              ? MessageCommon.getLocalGeometryBounds(current)
              : MessageCommon.getLocalGeometryBounds(candidate);
          if (this.isCandidateTooLarge(candidate, localBounds)) return false;
          shadowItems.set(id, candidate);
          break;
        }
        case "copy": {
          if (!id) return false;
          const current = readShadowItem(id);
          if (!current) return false;
          const validated = this.validateStoredCandidate(
            message.newid,
            structuredClone(current),
          );
          if (!validated.ok) return false;
          shadowItems.set(message.newid, validated.value);
          break;
        }
        case "child": {
          const current = readShadowItem(message.parent);
          if (!current || current.tool !== "Pencil") return false;
          const normalizedChild = normalizeStoredChildPoint(message);
          if (!normalizedChild.ok) return false;
          const currentChildren = Array.isArray(current._children)
            ? current._children.slice()
            : [];
          if (currentChildren.length >= config.MAX_CHILDREN) return false;
          const nextBounds = MessageCommon.extendBoundsWithPoint(
            MessageCommon.getLocalGeometryBounds(current),
            normalizedChild.value.x,
            normalizedChild.value.y,
          );
          if (this.isCandidateTooLarge(current, nextBounds)) return false;
          currentChildren.push(normalizedChild.value);
          shadowItems.set(
            message.parent,
            Object.assign({}, current, { _children: currentChildren }),
          );
          break;
        }
        default: {
          if (!id) return false;
          const validated = this.validateStoredCandidate(id, message);
          if (!validated.ok) return false;
          shadowItems.set(id, validated.value);
          break;
        }
      }
    }

    for (const message of messages) {
      if (!this.processMessage(message)) return false;
    }
    return true;
  }

  /** Process a single message
   * @param {BoardMessage} message instruction to apply to the board
   */
  processMessage(message) {
    if (message._children)
      return this.processMessageBatch(message._children, message);
    let id = message.id;
    switch (message.type) {
      case "delete":
        return id ? this.delete(id) : false;
      case "update":
        return id ? this.update(id, message) : false;
      case "copy":
        return id ? this.copy(id, message) : false;
      case "child":
        // We don't need to store 'type', 'parent', and 'tool' for each child. They will be rehydrated from the parent on the client side
        const { parent, type, tool, ...childData } = message;
        return this.addChild(parent, childData);
      case "clear":
        return this.clear();
      default:
        //Add data
        if (id) return this.set(id, message);
        console.error("Invalid message: ", message);
        return false;
    }
  }

  /** Reads data from the board
   * @param {string} id - Identifier of the element to get.
   * @returns {BoardElem} The element with the given id, or undefined if no element has this id
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
        log("removed empty board", { board: this.name });
      } catch (err) {
        if (err.code !== "ENOENT") {
          // If the file already wasn't saved, this is not an error
          log("board deletion error", { err: err.toString() });
        }
      }
    } else {
      try {
        await writeFile(tmp_file, board_txt, { flag: "wx" });
        await rename(tmp_file, file);
        log("saved board", {
          board: this.name,
          size: board_txt.length,
          delay_ms: Date.now() - this.lastSaveDate,
        });
      } catch (err) {
        log("board saving error", {
          board: this.name,
          err: err.toString(),
          tmp_file: tmp_file,
        });
        return;
      }
    }
  }

  /** Remove old elements from the board */
  clean() {
    var board = this.board;
    var ids = Object.keys(board);
    if (ids.length > config.MAX_ITEM_COUNT) {
      var toDestroy = ids
        .sort(function (x, y) {
          return (board[x].time | 0) - (board[y].time | 0);
        })
        .slice(0, -config.MAX_ITEM_COUNT);
      for (var i = 0; i < toDestroy.length; i++) delete board[toDestroy[i]];
      log("cleaned board", { removed: toDestroy.length, board: this.name });
    }
  }

  normalizeStoredElement(id) {
    const validated = this.validateStoredCandidate(id, this.board[id]);
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
    var boardData = new BoardData(name),
      data;
    try {
      data = await readFile(boardData.file);
      const storedBoard = parseStoredBoard(JSON.parse(data));
      boardData.board = storedBoard.board;
      boardData.metadata = storedBoard.metadata;
      for (const id of Object.keys(boardData.board)) {
        boardData.normalizeStoredElement(id);
      }
      log("disk load", { board: boardData.name });
    } catch (e) {
      // If the file doesn't exist, this is not an error
      if (e.code === "ENOENT") {
        log("empty board creation", { board: boardData.name });
      } else {
        log("board load error", {
          board: name,
          error: e.toString(),
          stack: e.stack,
        });
      }
      boardData.board = {};
      if (data) {
        // There was an error loading the board, but some data was still read
        var backup = backupFileName(boardData.file);
        log("Writing the corrupted file to " + backup);
        try {
          await writeFile(backup, data);
        } catch (err) {
          log("Error writing " + backup + ": " + err);
        }
      }
    }
    return boardData;
  }

  static loadMetadataSync(name) {
    const metadata = defaultBoardMetadata();
    try {
      const data = nativeFs.readFileSync(boardFilePath(name), {
        encoding: "utf8",
      });
      return parseStoredBoard(JSON.parse(data)).metadata;
    } catch (err) {
      if (err.code !== "ENOENT") {
        log("board metadata load error", {
          board: name,
          error: err.toString(),
        });
      }
      return metadata;
    }
  }
}

/**
 * Given a board file name, return a name to use for temporary data saving.
 * @param {string} baseName
 */
function backupFileName(baseName) {
  var date = new Date().toISOString().replace(/:/g, "");
  return baseName + "." + date + ".bak";
}

module.exports = {
  BoardData,
  BOARD_METADATA_KEY,
  parseStoredBoard,
};
