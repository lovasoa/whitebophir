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

var fs = require("./fs_promises.js"),
  log = require("./log.js").log,
  path = require("path"),
  config = require("./configuration.js"),
  Mutex = require("async-mutex").Mutex;

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
    this.file = path.join(
      config.HISTORY_DIR,
      "board-" + encodeURIComponent(name) + ".json"
    );
    this.lastSaveDate = Date.now();
    this.users = new Set();
    this.saveMutex = new Mutex();
  }

  /** Adds data to the board
   * @param {string} id
   * @param {BoardElem} data
   */
  set(id, data) {
    //KISS
    data.time = Date.now();
    this.validate(data);
    this.board[id] = data;
    this.delaySave();
  }

  /** Adds a child to an element that is already in the board
   * @param {string} parentId - Identifier of the parent element.
   * @param {BoardElem} child - Object containing the the values to update.
   * @returns {boolean} - True if the child was added, else false
   */
  addChild(parentId, child) {
    var obj = this.board[parentId];
    if (typeof obj !== "object") return false;
    if (Array.isArray(obj._children)) obj._children.push(child);
    else obj._children = [child];

    this.validate(obj);
    this.delaySave();
    return true;
  }

  /** Update the data in the board
   * @param {string} id - Identifier of the data to update.
   * @param {BoardElem} data - Object containing the values to update.
   * @param {boolean} create - True if the object should be created if it's not currently in the DB.
   */
  update(id, data, create) {
    delete data.type;
    delete data.tool;

    var obj = this.board[id];
    if (typeof obj === "object") {
      for (var i in data) {
        obj[i] = data[i];
      }
    } else if (create || obj !== undefined) {
      this.board[id] = data;
    }
    this.delaySave();
  }

  /** Removes data from the board
   * @param {string} id - Identifier of the data to delete.
   */
  delete(id) {
    //KISS
    delete this.board[id];
    this.delaySave();
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
  processMessageBatch(children) {
    for (const message of children) {
      this.processMessage(message);
    }
  }

  /** Process a single message
   * @param {BoardMessage} message instruction to apply to the board
   */
  processMessage(message) {
    if (message._children) return this.processMessageBatch(message._children);
    let id = message.id;
    switch (message.type) {
      case "delete":
        if (id) this.delete(id);
        break;
      case "update":
        if (id) this.update(id, message);
        break;
      case "child":
        this.addChild(message.parent, message);
        break;
      default:
        //Add data
        if (!id) throw new Error("Invalid message: ", message);
        this.set(id, message);
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
    this.saveMutex.runExclusive(this._unsafe_save.bind(this));
  }

  /** Save the board to disk without preventing multiple simultaneaous saves. Use save() instead */
  async _unsafe_save() {
    this.lastSaveDate = Date.now();
    this.clean();
    var file = this.file;
    var tmp_file = backupFileName(file);
    var board_txt = JSON.stringify(this.board);
    if (board_txt === "{}") {
      // empty board
      try {
        await fs.promises.unlink(file);
        log("removed empty board", { name: this.name });
      } catch (err) {
        if (err.code !== "ENOENT") {
          // If the file already wasn't saved, this is not an error
          log("board deletion error", { err: err.toString() });
        }
      }
    } else {
      try {
        await fs.promises.writeFile(tmp_file, board_txt, { flag: "wx" });
        await fs.promises.rename(tmp_file, file);
        log("saved board", {
          name: this.name,
          size: board_txt.length,
          delay_ms: Date.now() - this.lastSaveDate,
        });
      } catch (err) {
        log("board saving error", {
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

  /** Reformats an item if necessary in order to make it follow the boards' policy
   * @param {object} item The object to edit
   */
  validate(item) {
    if (item.hasOwnProperty("size")) {
      item.size = parseInt(item.size) || 1;
      item.size = Math.min(Math.max(item.size, 1), 50);
    }
    if (item.hasOwnProperty("x") || item.hasOwnProperty("y")) {
      item.x = parseFloat(item.x) || 0;
      item.x = Math.min(Math.max(item.x, 0), config.MAX_BOARD_SIZE);
      item.x = Math.round(10 * item.x) / 10;
      item.y = parseFloat(item.y) || 0;
      item.y = Math.min(Math.max(item.y, 0), config.MAX_BOARD_SIZE);
      item.y = Math.round(10 * item.y) / 10;
    }
    if (item.hasOwnProperty("opacity")) {
      item.opacity = Math.min(Math.max(item.opacity, 0.1), 1) || 1;
      if (item.opacity === 1) delete item.opacity;
    }
    if (item.hasOwnProperty("_children")) {
      if (!Array.isArray(item._children)) item._children = [];
      if (item._children.length > config.MAX_CHILDREN)
        item._children.length = config.MAX_CHILDREN;
      for (var i = 0; i < item._children.length; i++) {
        this.validate(item._children[i]);
      }
    }
  }

  /** Load the data in the board from a file.
   * @param {string} name - name of the board
   */
  static async load(name) {
    var boardData = new BoardData(name),
      data;
    try {
      data = await fs.promises.readFile(boardData.file);
      boardData.board = JSON.parse(data);
      for (const id in boardData.board) boardData.validate(boardData.board[id]);
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
          await fs.promises.writeFile(backup, data);
        } catch (err) {
          log("Error writing " + backup + ": " + err);
        }
      }
    }
    return boardData;
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

module.exports.BoardData = BoardData;
