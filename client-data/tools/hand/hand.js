/**
 *						  WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *	JavaScript code in this page.
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

(function hand() {
  //Code isolation
  /** @typedef {{ x: number, y: number }} PointSelection */
  /** @typedef {PointSelection & { w: number, h: number }} ScaleSelection */
  /** @typedef {PointSelection | ScaleSelection | null} SelectionState */
  /** @typedef {{ x: number, y: number }} TranslationTransform */
  /** @typedef {{ a: number, d: number, e: number, f: number }} ScaleRectTransform */
  /** @typedef {TranslationTransform | ScaleRectTransform | undefined} SelectionRectTransformState */
  /** @typedef {{ a: number, b: number, c: number, d: number, e: number, f: number }} MatrixState */
  /** @typedef {{ type: "update", id: string, transform: MatrixState }} HandUpdateMessage */
  /** @typedef {{ type: "copy", id: string, newid: string }} HandCopyMessage */
  /** @typedef {{ type: "delete", id: string, tool?: string }} HandDeleteMessage */
  /** @typedef {{ _children: (HandUpdateMessage | HandCopyMessage | HandDeleteMessage)[] }} HandBatchMessage */
  /** @typedef {HandUpdateMessage | HandCopyMessage | HandDeleteMessage | HandBatchMessage} HandMessage */
  /** @typedef {(x: number, y: number, force: boolean) => void} TransformHandler */
  /** @typedef {SVGGraphicsElement & { id: string }} SelectableElement */
  /** @typedef {SVGImageElement & { origWidth: number, origHeight: number, drawCallback: SelectionButtonDraw, clickCallback: SelectionButtonClick }} SelectionButton */
  /** @typedef {{ r: [number, number], a: [number, number], b: [number, number] }} SelectionBBox */
  /** @typedef {(button: SelectionButton, bbox: SelectionBBox, scale: number) => void} SelectionButtonDraw */
  /** @typedef {(x: number, y: number, evt: ToolPointerEvent) => void} SelectionButtonClick */
  /** @typedef {{ preventDefault(): void, target: EventTarget | null, clientX?: number, clientY?: number }} ToolPointerEvent */
  /** @typedef {{ key: string, target: EventTarget | null }} ToolKeyEvent */
  /** @typedef {{ matches(selector: string): boolean }} MatchableTarget */
  /** @typedef {{ name: string, icon: string, active: boolean, switch?: () => void }} ToolSecondaryMode */
  /** @typedef {{ name: string, shortcut?: string, listeners: { press: typeof press, move: typeof move, release: typeof release }, onquit?: () => void, secondary: ToolSecondaryMode | null, draw: typeof draw, icon: string, mouseCursor: string, showMarker: boolean }} HandTool */
  var BoardMessages = window.WBOBoardMessages;
  var selectorStates = {
    pointing: 0,
    selecting: 1,
    transform: 2,
  };
  /** @type {SelectionState} */
  var selected = null;
  /** @type {SelectableElement[]} */
  var selected_els = [];
  var selectionRect = createSelectorRect();
  /** @type {SelectionRectTransformState} */
  var selectionRectTransform;
  /** @type {TransformHandler | null} */
  var currentTransform = null;
  /** @type {MatrixState[]} */
  var transform_elements = [];
  var selectorState = selectorStates.pointing;
  var last_sent = 0;
  var blockedSelectionButtons = Tools.server_config.BLOCKED_SELECTION_BUTTONS || [];
  /** @type {SelectionButton[]} */
  var selectionButtons = [
    createButton(
      "delete",
      "delete",
      24,
      24,
      /** @type {SelectionButtonDraw} */
      function (me, bbox, s) {
        me.width.baseVal.value = me.origWidth / s;
        me.height.baseVal.value = me.origHeight / s;
        me.x.baseVal.value = bbox.r[0];
        me.y.baseVal.value = bbox.r[1] - (me.origHeight + 3) / s;
        me.style.display = "";
      },
      deleteSelection,
    ),

    createButton(
      "duplicate",
      "duplicate",
      24,
      24,
      /** @type {SelectionButtonDraw} */
      function (me, bbox, s) {
        me.width.baseVal.value = me.origWidth / s;
        me.height.baseVal.value = me.origHeight / s;
        me.x.baseVal.value = bbox.r[0] + (me.origWidth + 2) / s;
        me.y.baseVal.value = bbox.r[1] - (me.origHeight + 3) / s;
        me.style.display = "";
      },
      duplicateSelection,
    ),

    createButton(
      "scaleHandle",
      "handle",
      14,
      14,
      /** @type {SelectionButtonDraw} */
      function (me, bbox, s) {
        me.width.baseVal.value = me.origWidth / s;
        me.height.baseVal.value = me.origHeight / s;
        me.x.baseVal.value = bbox.r[0] + bbox.a[0] - me.origWidth / (2 * s);
        me.y.baseVal.value = bbox.r[1] + bbox.b[1] - me.origHeight / (2 * s);
        me.style.display = "";
      },
      startScalingTransform,
    ),
  ];

  blockedSelectionButtons.forEach(function (buttonIndex) {
    if (typeof buttonIndex === "number") delete selectionButtons[buttonIndex];
  });

  var getScale = Tools.getScale;

  /**
   * @param {EventTarget | null} target
   * @returns {target is SelectableElement}
   */
  function isSelectableElement(target) {
    return !!(
      target &&
      typeof target === "object" &&
      "id" in target &&
      "transform" in target &&
      "transformedBBox" in target
    );
  }

  /**
   * @param {EventTarget | null} target
   * @returns {target is MatchableTarget}
   */
  function isMatchableTarget(target) {
    return !!(target && typeof target === "object" && "matches" in target);
  }

  /**
   * @param {unknown} value
   * @returns {value is HandBatchMessage}
   */
  function isBatchMessage(value) {
    return !!(value && typeof value === "object" && "_children" in value);
  }

  /**
   * @param {EventTarget | null} el
   * @returns {SelectableElement | null}
   */
  function getParentMathematics(el) {
    if (!isSelectableElement(el)) return null;
    var target;
    /** @type {SelectableElement | null} */
    var a = el;
    /** @type {SelectableElement[]} */
    var els = [];
    while (a) {
      els.unshift(a);
      /** @type {EventTarget | null} */
      var parentElement = a.parentElement;
      a = parentElement && isSelectableElement(parentElement) ? parentElement : null;
    }
    var parentMathematics = els.find(function (el) {
      return el.getAttribute("class") === "MathElement";
    });
    if (parentMathematics && parentMathematics.tagName === "svg") {
      target = /** @type {SelectableElement} */ (parentMathematics);
    }
    return target || /** @type {SelectableElement} */ (el);
  }

  function deleteSelection() {
    /** @type {HandDeleteMessage[]} */
    var msgs = selected_els.map(function (el) {
      return {
        type: "delete",
        id: el.id,
      };
    });
    /** @type {HandBatchMessage} */
    var data = {
      _children: msgs,
    };
    Tools.drawAndSend(data);
    selected_els = [];
    hideSelectionUI();
  }

  function duplicateSelection() {
    if (!(selectorState == selectorStates.pointing) || selected_els.length == 0)
      return;
    /** @type {HandCopyMessage[]} */
    var msgs = [];
    /** @type {string[]} */
    var newids = [];
    for (var i = 0; i < selected_els.length; i++) {
      var selectedElement = selected_els[i];
      if (!selectedElement) continue;
      var id = selectedElement.id;
      var newid = Tools.generateUID(id[0]);
      msgs[i] = {
        type: "copy",
        id: id,
        newid: newid,
      };
      newids[i] = newid;
    }
    Tools.drawAndSend({ _children: msgs });
    selected_els = newids
      .map(function (id) {
        var element = Tools.svg.getElementById(id);
        return isSelectableElement(element) ? element : null;
      })
      .filter(function (element) {
        return element !== null;
      });
  }

  /** @returns {SVGRectElement} */
  function createSelectorRect() {
    var shape = /** @type {SVGRectElement} */ (Tools.createSVGElement("rect"));
    shape.id = "selectionRect";
    shape.x.baseVal.value = 0;
    shape.y.baseVal.value = 0;
    shape.width.baseVal.value = 0;
    shape.height.baseVal.value = 0;
    shape.setAttribute("stroke", "black");
    shape.setAttribute("stroke-width", "1");
    shape.setAttribute("vector-effect", "non-scaling-stroke");
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke-dasharray", "5 5");
    shape.setAttribute("opacity", "1");
    Tools.svg.appendChild(shape);
    return shape;
  }

  /**
   * @param {string} name
   * @param {string} icon
   * @param {number} width
   * @param {number} height
   * @param {SelectionButtonDraw} drawCallback
   * @param {SelectionButtonClick} clickCallback
   * @returns {SelectionButton}
   */
  function createButton(
    name,
    icon,
    width,
    height,
    drawCallback,
    clickCallback,
  ) {
    var shape = Tools.createSVGElement("image", {
      href: "tools/hand/" + icon + ".svg",
      width: width,
      height: height,
    });
    shape.style.display = "none";
    shape.origWidth = width;
    shape.origHeight = height;
    shape.drawCallback = drawCallback;
    shape.clickCallback = clickCallback;
    Tools.svg.appendChild(shape);
    return /** @type {SelectionButton} */ (shape);
  }

  function showSelectionButtons() {
    var scale = getScale();
    var selectionBBox = selectionRect.transformedBBox();
    for (var i = 0; i < selectionButtons.length; i++) {
      var button = selectionButtons[i];
      if (button) {
        button.drawCallback(button, selectionBBox, scale);
      }
    }
  }

  function hideSelectionButtons() {
    for (var i = 0; i < selectionButtons.length; i++) {
      var button = selectionButtons[i];
      if (button) button.style.display = "none";
    }
  }

  function hideSelectionUI() {
    hideSelectionButtons();
    selectionRect.style.display = "none";
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   */
  function startMovingElements(x, y, evt) {
    evt.preventDefault();
    selectorState = selectorStates.transform;
    currentTransform = moveSelection;
    selected = { x: x, y: y };
    // Some of the selected elements could have been deleted
    selected_els = selected_els.filter(function (el) {
      return Tools.svg.getElementById(el.id) !== null;
    });
    transform_elements = selected_els.map(function (el) {
      var tmatrix = get_transform_matrix(el);
      return {
        a: tmatrix.a,
        b: tmatrix.b,
        c: tmatrix.c,
        d: tmatrix.d,
        e: tmatrix.e,
        f: tmatrix.f,
      };
    });
    var tmatrix = get_transform_matrix(selectionRect);
    selectionRectTransform = { x: tmatrix.e, y: tmatrix.f };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   */
  function startScalingTransform(x, y, evt) {
    evt.preventDefault();
    hideSelectionButtons();
    selectorState = selectorStates.transform;
    var bbox = selectionRect.transformedBBox();
    selected = {
      x: bbox.r[0],
      y: bbox.r[1],
      w: bbox.a[0],
      h: bbox.b[1],
    };
    transform_elements = selected_els.map(function (el) {
      var tmatrix = get_transform_matrix(el);
      return {
        a: tmatrix.a,
        b: tmatrix.b,
        c: tmatrix.c,
        d: tmatrix.d,
        e: tmatrix.e,
        f: tmatrix.f,
      };
    });
    var tmatrix = get_transform_matrix(selectionRect);
    selectionRectTransform = {
      a: tmatrix.a,
      d: tmatrix.d,
      e: tmatrix.e,
      f: tmatrix.f,
    };
    currentTransform = scaleSelection;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   */
  function startSelector(x, y, evt) {
    evt.preventDefault();
    selected = { x: x, y: y };
    selected_els = [];
    selectorState = selectorStates.selecting;
    selectionRect.x.baseVal.value = x;
    selectionRect.y.baseVal.value = y;
    selectionRect.width.baseVal.value = 0;
    selectionRect.height.baseVal.value = 0;
    selectionRect.style.display = "";
    var tmatrix = get_transform_matrix(selectionRect);
    tmatrix.e = 0;
    tmatrix.f = 0;
  }

  function calculateSelection() {
    var selectionTBBox = selectionRect.transformedBBox();
    if (!Tools.drawingArea) return [];
    var elements = Tools.drawingArea.children;
    /** @type {SelectableElement[]} */
    var selected = [];
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (!element) continue;
      if (
        isSelectableElement(element) &&
        transformedBBoxIntersects(selectionTBBox, element.transformedBBox())
      )
        selected.push(element);
    }
    return selected;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean} force
   */
  function moveSelection(x, y, force) {
    if (!selected || !selectionRectTransform || !("x" in selectionRectTransform)) {
      return;
    }
    var pointSelection = selected;
    var rectTranslation = selectionRectTransform;
    var dx = x - selected.x;
    var dy = y - selected.y;
    /** @type {HandUpdateMessage[]} */
    var msgs = selected_els.map(function (el, i) {
      var oldTransform = transform_elements[i];
      if (!oldTransform) {
        throw new Error("Mover: Missing transform state while moving.");
      }
      return {
        type: "update",
        id: el.id,
        transform: {
          a: oldTransform.a,
          b: oldTransform.b,
          c: oldTransform.c,
          d: oldTransform.d,
          e: dx + oldTransform.e,
          f: dy + oldTransform.f,
        },
      };
    });
    /** @type {HandBatchMessage} */
    var msg = {
      _children: msgs,
    };
    var tmatrix = get_transform_matrix(selectionRect);
    tmatrix.e = dx + rectTranslation.x;
    tmatrix.f = dy + rectTranslation.y;
    dispatchTransform(msg, force);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean} force
   */
  function scaleSelection(x, y, force) {
    if (
      !selected ||
      !selectionRectTransform ||
      !("a" in selectionRectTransform) ||
      !("w" in selected) ||
      !("h" in selected)
    ) {
      return;
    }
    var scaleSelectionState = selected;
    var rectTransform = selectionRectTransform;
    var rx = (x - scaleSelectionState.x) / scaleSelectionState.w;
    var ry = (y - scaleSelectionState.y) / scaleSelectionState.h;
    /** @type {HandUpdateMessage[]} */
    var msgs = selected_els.map(function (el, i) {
      var oldTransform = transform_elements[i];
      if (!oldTransform) {
        throw new Error("Mover: Missing transform state while scaling.");
      }
      var x = el.transformedBBox().r[0];
      var y = el.transformedBBox().r[1];
      var a = oldTransform.a * rx;
      var d = oldTransform.d * ry;
      var e =
        scaleSelectionState.x * (1 - rx) -
        x * a +
        (x * oldTransform.a + oldTransform.e) * rx;
      var f =
        scaleSelectionState.y * (1 - ry) -
        y * d +
        (y * oldTransform.d + oldTransform.f) * ry;
      return {
        type: "update",
        id: el.id,
        transform: {
          a: a,
          b: oldTransform.b,
          c: oldTransform.c,
          d: d,
          e: e,
          f: f,
        },
      };
    });
    /** @type {HandBatchMessage} */
    var msg = {
      _children: msgs,
    };

    var tmatrix = get_transform_matrix(selectionRect);
    tmatrix.a = rx;
    tmatrix.d = ry;
    tmatrix.e =
      rectTransform.e +
      selectionRect.x.baseVal.value * (rectTransform.a - rx);
    tmatrix.f =
      rectTransform.f +
      selectionRect.y.baseVal.value * (rectTransform.d - ry);
    dispatchTransform(msg, force);
  }

  /**
   * @param {HandBatchMessage} msg
   * @param {boolean} force
   */
  function dispatchTransform(msg, force) {
    var now = performance.now();
    if (force || now - last_sent > 70) {
      last_sent = now;
      Tools.drawAndSend(msg);
    } else {
      draw(msg);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {SVGRectElement} rect
   */
  function updateRect(x, y, rect) {
    if (!selected) return;
    rect.x.baseVal.value = Math.min(x, selected.x);
    rect.y.baseVal.value = Math.min(y, selected.y);
    rect.width.baseVal.value = Math.abs(x - selected.x);
    rect.height.baseVal.value = Math.abs(y - selected.y);
  }

  function resetSelectionRect() {
    var bbox = selectionRect.transformedBBox();
    var tmatrix = get_transform_matrix(selectionRect);
    selectionRect.x.baseVal.value = bbox.r[0];
    selectionRect.y.baseVal.value = bbox.r[1];
    selectionRect.width.baseVal.value = bbox.a[0];
    selectionRect.height.baseVal.value = bbox.b[1];
    tmatrix.a = 1;
    tmatrix.b = 0;
    tmatrix.c = 0;
    tmatrix.d = 1;
    tmatrix.e = 0;
    tmatrix.f = 0;
  }

  /**
   * @param {SelectableElement | SVGRectElement} elem
   * @returns {MatrixState}
   */
  function get_transform_matrix(elem) {
    // Returns the first translate or transform matrix or makes one
    var transform = null;
    for (var i = 0; i < elem.transform.baseVal.numberOfItems; ++i) {
      var baseVal = elem.transform.baseVal[i];
      // quick tests showed that even if one changes only the fields e and f or uses createSVGTransformFromMatrix
      // the brower may add a SVG_TRANSFORM_MATRIX instead of a SVG_TRANSFORM_TRANSLATE
      if (baseVal && baseVal.type === SVGTransform.SVG_TRANSFORM_MATRIX) {
        transform = baseVal;
        break;
      }
    }
    if (transform == null) {
      transform = elem.transform.baseVal.createSVGTransformFromMatrix(
        Tools.svg.createSVGMatrix(),
      );
      elem.transform.baseVal.appendItem(transform);
    }
    return transform.matrix;
  }

  /** @param {HandMessage} data */
  function draw(data) {
    if (isBatchMessage(data)) {
      BoardMessages.batchCall(draw, data._children);
    } else {
      switch (data.type) {
        case "update":
          var elem = Tools.svg.getElementById(data.id);
          if (!elem)
            throw new Error(
              "Mover: Tried to move an element that does not exist.",
            );
          var tmatrix = get_transform_matrix(
            /** @type {SelectableElement} */ (elem),
          );
          tmatrix.a = data.transform.a;
          tmatrix.b = data.transform.b;
          tmatrix.c = data.transform.c;
          tmatrix.d = data.transform.d;
          tmatrix.e = data.transform.e;
          tmatrix.f = data.transform.f;
          break;
        case "copy":
          if (!Tools.drawingArea) {
            throw new Error("Mover: Missing drawing area while copying.");
          }
          var sourceElement = Tools.svg.getElementById(data.id);
          if (!isSelectableElement(sourceElement)) {
            throw new Error(
              "Mover: Tried to copy an element that does not exist.",
            );
          }
          var newElement = /** @type {SelectableElement} */ (sourceElement.cloneNode(true));
          newElement.id = data.newid;
          Tools.drawingArea.appendChild(newElement);
          break;
        case "delete":
          data.tool = "Eraser";
          messageForTool(data);
          break;
        default:
          throw new Error("Mover: 'move' instruction with unknown type.");
      }
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   */
  function clickSelector(x, y, evt) {
    selectionRect = selectionRect || createSelectorRect();
    /** @type {SelectionButton | undefined} */
    var button;
    for (var i = 0; i < selectionButtons.length; i++) {
      var candidate = selectionButtons[i];
      if (candidate && evt.target && candidate.contains(/** @type {Node} */ (evt.target))) {
        button = candidate;
      }
    }
    if (button) {
      button.clickCallback(x, y, evt);
    } else if (
      pointInTransformedBBox([x, y], selectionRect.transformedBBox())
    ) {
      hideSelectionButtons();
      startMovingElements(x, y, evt);
    } else if (
      Tools.drawingArea &&
      evt.target &&
      Tools.drawingArea.contains(/** @type {Node} */ (evt.target))
    ) {
      hideSelectionUI();
      var parent = getParentMathematics(evt.target);
      if (!parent) {
        startSelector(x, y, evt);
        return;
      }
      selected_els = [parent];
      startMovingElements(x, y, evt);
    } else {
      hideSelectionButtons();
      startSelector(x, y, evt);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   */
  function releaseSelector(x, y, evt) {
    if (selectorState == selectorStates.selecting) {
      selected_els = calculateSelection();
      if (selected_els.length == 0) {
        hideSelectionUI();
      }
    } else if (selectorState == selectorStates.transform) resetSelectionRect();
    if (selected_els.length != 0) showSelectionButtons();
    transform_elements = [];
    selectorState = selectorStates.pointing;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   * @param {boolean} force
   */
  function moveSelector(x, y, evt, force) {
    if (selectorState == selectorStates.selecting) {
      updateRect(x, y, selectionRect);
    } else if (selectorState == selectorStates.transform && currentTransform) {
      currentTransform(x, y, force);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  function startHand(x, y, evt, isTouchEvent) {
    if (!isTouchEvent) {
      selected = {
        x: document.documentElement.scrollLeft + (evt.clientX || 0),
        y: document.documentElement.scrollTop + (evt.clientY || 0),
      };
    }
  }
  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  function moveHand(x, y, evt, isTouchEvent) {
    if (selected && !("w" in selected) && !isTouchEvent) {
      //Let the browser handle touch to scroll
      window.scrollTo(
        selected.x - (evt.clientX || 0),
        selected.y - (evt.clientY || 0),
      );
    }
  }

  /** @returns {boolean} */
  function isSelectorActive() {
    return !!(handTool.secondary && handTool.secondary.active);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  function press(x, y, evt, isTouchEvent) {
    if (!isSelectorActive()) startHand(x, y, evt, isTouchEvent);
    else clickSelector(x, y, evt);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   * @param {boolean} isTouchEvent
   * @param {boolean} force
   */
  function move(x, y, evt, isTouchEvent, force) {
    if (!isSelectorActive()) moveHand(x, y, evt, isTouchEvent);
    else moveSelector(x, y, evt, force);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ToolPointerEvent} evt
   * @param {boolean} isTouchEvent
   */
  function release(x, y, evt, isTouchEvent) {
    move(x, y, evt, isTouchEvent, true);
    if (isSelectorActive()) releaseSelector(x, y, evt);
    selected = null;
  }

  /** @param {ToolKeyEvent} e */
  function deleteShortcut(e) {
    if (
      e.key == "Delete" &&
      (!isMatchableTarget(e.target) ||
        !e.target.matches("input[type=text], textarea"))
    )
      deleteSelection();
  }

  /** @param {ToolKeyEvent} e */
  function duplicateShortcut(e) {
    if (
      e.key == "d" &&
      (!isMatchableTarget(e.target) ||
        !e.target.matches("input[type=text], textarea"))
    )
      duplicateSelection();
  }

  function switchTool() {
    onquit();
    if (isSelectorActive()) {
      window.addEventListener("keydown", deleteShortcut);
      window.addEventListener("keydown", duplicateShortcut);
    }
  }

  function onquit() {
    selected = null;
    hideSelectionUI();
    window.removeEventListener("keydown", deleteShortcut);
    window.removeEventListener("keydown", duplicateShortcut);
  }

  /** @type {HandTool} */
  var handTool = {
    //The new tool
    name: "Hand",
    shortcut: "h",
    listeners: {
      press: press,
      move: move,
      release: release,
    },
    onquit: onquit,
    secondary: Tools.canWrite
      ? {
          name: "Selector",
          icon: "tools/hand/selector.svg",
          active: false,
          switch: switchTool,
        }
      : null,
    draw: draw,
    icon: "tools/hand/hand.svg",
    mouseCursor: "move",
    showMarker: true,
  };
  Tools.add(handTool);
  Tools.change("Hand"); // Use the hand tool by default
})(); //End of code isolation
