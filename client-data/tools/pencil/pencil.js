/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
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
 */

(function () {
  //Code isolation
  /** @typedef {{type: "line", id: string, color?: string, size?: number, opacity?: number}} PencilLineData */
  /** @typedef {{type: "child", parent: string, x: number, y: number}} PencilChildData */
  /** @typedef {PencilLineData | PencilChildData | {type: "endline"} | {type?: string, id?: string, color?: string, size?: number, opacity?: number, parent?: string, x?: number, y?: number}} PencilMessage */
  /** @typedef {SVGPathElement & {id: string}} PencilLine */

  // Allocate the full maximum server update rate to pencil messages.
  // This feels a bit risky in terms of dropped messages, but any less
  // gives terrible results with the default parameters.  In practice it
  // seems to work, either because writing tends to happen in bursts, or
  // maybe because the messages are sent when the time interval is *greater*
  // than this?
  var MIN_PENCIL_INTERVAL_MS =
    (Number(Tools.server_config.MAX_EMIT_COUNT_PERIOD) || 4096) /
    (Number(Tools.server_config.MAX_EMIT_COUNT) || 192);

  var AUTO_FINGER_WHITEOUT = Tools.server_config.AUTO_FINGER_WHITEOUT === true;
  var hasUsedStylus = false;

  //Indicates the id of the line the user is currently drawing or an empty string while the user is not drawing
  var curLineId = "",
    lastTime = performance.now(); //The time at which the last point was drawn
  var hasSentPoint = false;

  //The data of the message that will be sent for every new point
  /**
   * @constructor
   * @param {number} x
   * @param {number} y
   */
  function PointMessage(x, y) {
    this.type = "child";
    this.parent = curLineId;
    this.x = x;
    this.y = y;
  }

  /** @param {TouchEvent} evt */
  function handleAutoWhiteOut(evt) {
    var touch = evt.touches && evt.touches[0];
    var touchType =
      touch && "touchType" in touch
        ? /** @type {{touchType?: string}} */ (touch).touchType
        : undefined;
    if (touchType == "stylus") {
      //When using stylus, switch back to the primary
      if (
        hasUsedStylus &&
        Tools.curTool &&
        Tools.curTool.secondary &&
        Tools.curTool.secondary.active
      ) {
        Tools.change("Pencil");
      }
      //Remember if starting a line with a stylus
      hasUsedStylus = true;
    }
    if (touchType == "direct") {
      //When used stylus and touched with a finger, switch to secondary
      if (
        hasUsedStylus &&
        Tools.curTool &&
        Tools.curTool.secondary &&
        !Tools.curTool.secondary.active
      ) {
        Tools.change("Pencil");
      }
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent} evt
   */
  function startLine(x, y, evt) {
    //Prevent the press from being interpreted by the browser
    evt.preventDefault();

    if (
      AUTO_FINGER_WHITEOUT &&
      typeof TouchEvent !== "undefined" &&
      evt instanceof TouchEvent
    ) {
      handleAutoWhiteOut(evt);
    }

    curLineId = Tools.generateUID("l"); //"l" for line
    hasSentPoint = false;

    var initialData = {
      type: "line",
      id: curLineId,
      color: pencilTool.secondary.active ? "#ffffff" : Tools.getColor(),
      size: Tools.getSize(),
      opacity: pencilTool.secondary.active ? 1 : Tools.getOpacity(),
    };

    draw(initialData);
    Tools.drawAndSend(initialData);

    //Immediatly add a point to the line
    continueLine(x, y, evt);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {MouseEvent | TouchEvent | undefined} evt
   */
  function continueLine(x, y, evt) {
    /*Wait 70ms before adding any point to the currently drawing line.
		This allows the animation to be smother*/
    if (
      curLineId !== "" &&
      (!hasSentPoint || performance.now() - lastTime > MIN_PENCIL_INTERVAL_MS)
    ) {
      Tools.drawAndSend(new PointMessage(x, y));
      hasSentPoint = true;
      lastTime = performance.now();
    }
    if (evt) evt.preventDefault();
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  function stopLineAt(x, y) {
    //Add a last point to the line
    continueLine(x, y, undefined);
    stopLine();
  }

  function stopLine() {
    curLineId = "";
    hasSentPoint = false;
  }

  /** @type {PencilLine | null} */
  var renderingLine = null;
  /** @param {PencilMessage} data */
  function draw(data) {
    Tools.drawingEvent = true;
    switch (data.type) {
      case "line":
        renderingLine = createLine(/** @type {PencilLineData} */ (data));
        break;
      case "child":
        var childData = /** @type {PencilChildData} */ (data);
        var line =
          renderingLine && renderingLine.id === childData.parent
            ? renderingLine
            : getLineById(childData.parent);
        if (!line) {
          console.error(
            "Pencil: Hmmm... I received a point of a line that has not been created (%s).",
            childData.parent,
          );
          line = renderingLine = createLine({
            type: "line",
            id: childData.parent,
          }); //create a new line in order not to loose the points
        }
        addPoint(line, childData.x, childData.y);
        break;
      case "endline":
        //TODO?
        break;
      default:
        console.error("Pencil: Draw instruction with unknown type. ", data);
        break;
    }
  }

  /** @type {{[lineId: string]: any[]}} */
  var pathDataCache = {};
  /** @param {PencilLine} line */
  function getPathData(line) {
    var pathData = pathDataCache[line.id];
    if (!pathData) {
      pathData = line.getPathData();
      pathDataCache[line.id] = pathData;
    }
    return pathData;
  }

  var svg = Tools.svg;

  /**
   * @param {string | undefined} lineId
   * @returns {PencilLine | null}
   */
  function getLineById(lineId) {
    if (!lineId) return null;
    var line = svg.getElementById(lineId);
    return line instanceof SVGPathElement
      ? /** @type {PencilLine} */ (line)
      : null;
  }

  /**
   * @param {PencilLine} line
   * @param {number} x
   * @param {number} y
   */
  function addPoint(line, x, y) {
    var pts = getPathData(line);
    pts = wboPencilPoint(pts, x, y);
    line.setPathData(pts);
  }

  /**
   * @param {PencilLineData} lineData
   * @returns {PencilLine}
   */
  function createLine(lineData) {
    //Creates a new line on the canvas, or update a line that already exists with new information
    var line = getLineById(lineData.id);
    if (line) {
      // Replays can recreate an existing DOM node after reconnect; reset the path before reapplying children.
      line.setPathData([]);
      delete pathDataCache[lineData.id];
    } else {
      line = /** @type {PencilLine} */ (Tools.createSVGElement("path"));
    }
    line.id = lineData.id || "";
    //If some data is not provided, choose default value. The line may be updated later
    line.setAttribute("stroke", lineData.color || "black");
    line.setAttribute("stroke-width", String(lineData.size || 10));
    line.setAttribute(
      "opacity",
      String(Math.max(0.1, Math.min(1, Number(lineData.opacity) || 1))),
    );
    if (!Tools.drawingArea) {
      throw new Error("Missing drawing area for pencil tool");
    }
    Tools.drawingArea.appendChild(line);
    return line;
  }

  //Remember drawing and white-out sizes separately
  var drawingSize = -1;
  var whiteOutSize = -1;

  function restoreDrawingSize() {
    whiteOutSize = Tools.getSize();
    if (drawingSize != -1) {
      Tools.setSize(drawingSize);
    }
  }

  function restoreWhiteOutSize() {
    drawingSize = Tools.getSize();
    if (whiteOutSize != -1) {
      Tools.setSize(whiteOutSize);
    }
  }

  //Restore remembered size after switch
  function toggleSize() {
    if (pencilTool.secondary.active) {
      restoreWhiteOutSize();
    } else {
      restoreDrawingSize();
    }
  }

  var pencilTool = {
    name: "Pencil",
    shortcut: "p",
    listeners: {
      press: startLine,
      move: continueLine,
      release: stopLineAt,
    },
    draw: draw,
    onstart: function () {
      //Reset stylus
      hasUsedStylus = false;

      //When switching from another tool to white-out, restore white-out size
      if (pencilTool.secondary.active) {
        restoreWhiteOutSize();
      }
    },
    secondary: {
      name: "White-out",
      icon: "tools/pencil/whiteout_tape.svg",
      active: false,
      switch: function () {
        stopLine();
        toggleSize();
      },
    },
    onquit: function () {
      //When switching from white-out to another tool, restore drawing size
      if (pencilTool.secondary.active) {
        restoreDrawingSize();
      }
    },
    mouseCursor: "url('tools/pencil/cursor.svg'), crosshair",
    icon: "tools/pencil/icon.svg",
    stylesheet: "tools/pencil/pencil.css",
  };
  Tools.add(pencilTool);
})(); //End of code isolation
