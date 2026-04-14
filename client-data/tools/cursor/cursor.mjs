export function createTool(runtime) {
  function getPositiveNumber(value, fallback) {
    const number = Number(value);
    return number > 0 ? number : fallback;
  }

  function getMinCursorUpdateIntervalMs() {
    const generalLimit = runtime.serverConfig?.RATE_LIMITS?.general || {};
    return (
      (getPositiveNumber(generalLimit.periodMs, 4096) /
        getPositiveNumber(generalLimit.limit, 192)) *
      2
    );
  }

  function isCursorElement(element) {
    return !!(
      element &&
      typeof element === "object" &&
      "style" in element &&
      "setAttributeNS" in element
    );
  }

  const CURSOR_DELETE_AFTER_MS = 1000 * 5;
  let lastCursorUpdate = 0;
  let sending = true;

  const message = {
    type: "update",
    x: 0,
    y: 0,
    color: runtime.getColor(),
    size: runtime.getSize(),
  };

  function handleMarker(x, y) {
    message.x = x;
    message.y = y;
    message.color = runtime.getColor();
    message.size = runtime.getSize();
    updateMarker();
  }

  function onSizeChange(size) {
    message.size = size;
    updateMarker();
  }

  function updateMarker() {
    const activeTool = runtime.tools ? runtime.tools.getCurrentTool() : null;
    if (runtime.showMarker === false || runtime.showMyCursor === false) return;

    const cur_time = Date.now();
    if (
      cur_time - lastCursorUpdate > getMinCursorUpdateIntervalMs() &&
      (sending || (activeTool && activeTool.showMarker === true))
    ) {
      runtime.drawAndSend(message);
      lastCursorUpdate = cur_time;
    } else {
      draw(message);
    }
  }

  function getCursorsLayer() {
    const existingLayer = runtime.svgElement.getElementById("cursors");
    if (existingLayer instanceof SVGGElement) return existingLayer;

    const createdLayer = runtime.createSVGElement("g");
    createdLayer.setAttributeNS(null, "id", "cursors");
    runtime.svgElement.appendChild(createdLayer);
    return createdLayer;
  }

  function createCursor(id) {
    const cursorsElem = getCursorsLayer();
    const cursor = runtime.createSVGElement("circle");
    cursor.setAttributeNS(null, "class", "opcursor");
    cursor.setAttributeNS(null, "id", id);
    cursor.setAttributeNS(null, "cx", "0");
    cursor.setAttributeNS(null, "cy", "0");
    cursor.setAttributeNS(null, "r", "10");
    cursorsElem.appendChild(cursor);
    setTimeout(() => {
      if (cursorsElem.contains(cursor)) {
        cursorsElem.removeChild(cursor);
      }
    }, CURSOR_DELETE_AFTER_MS);
    return cursor;
  }

  function getCursor(id) {
    const existingCursor = document.getElementById(id);
    return isCursorElement(existingCursor) ? existingCursor : createCursor(id);
  }

  function draw(message) {
    const cursor = getCursor(`cursor-${message.socket || "me"}`);
    cursor.style.transform = `translate(${message.x}px, ${message.y}px)`;

    // Fallback for older browsers like IE
    if (
      navigator.userAgent.indexOf("MSIE") !== -1 ||
      navigator.appVersion.indexOf("Trident/") > -1
    ) {
      cursor.setAttributeNS(
        null,
        "transform",
        `translate(${message.x} ${message.y})`,
      );
    }

    cursor.setAttributeNS(null, "fill", message.color);
    cursor.setAttributeNS(null, "r", String(message.size / 2));
  }

  const cursorTool = {
    name: "Cursor",
    listeners: {
      press: () => {
        sending = false;
      },
      move: handleMarker,
      release: () => {
        sending = true;
      },
    },
    onSizeChange: onSizeChange,
    draw: draw,
    mouseCursor: "crosshair",
    icon: "tools/pencil/icon.svg",
    showMarker: true,
  };

  return cursorTool;
}
