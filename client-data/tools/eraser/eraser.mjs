export function createTool(runtime) {
  let erasing = false;

  function startErasing(x, y, evt) {
    evt.preventDefault();
    erasing = true;
    erase(x, y, evt);
  }

  function isElement(elem) {
    return !!(elem && typeof elem === "object" && "parentNode" in elem);
  }

  function isErasableElement(elem) {
    return !!(isElement(elem) && typeof elem.id === "string" && elem.id !== "");
  }

  function inDrawingArea(elem) {
    return !!(
      runtime.drawingArea &&
      isElement(elem) &&
      runtime.drawingArea.contains(elem)
    );
  }

  function resolveTarget(evt) {
    let target = evt.target;
    if (evt.type === "touchmove" || evt.type === "touchstart") {
      const touch = evt.touches?.[0];
      if (touch) {
        target = document.elementFromPoint(touch.clientX, touch.clientY);
      }
    }
    return target;
  }

  function erase(_x, _y, evt) {
    const target = resolveTarget(evt);
    if (
      erasing &&
      target !== runtime.svgElement &&
      target !== runtime.drawingArea &&
      isErasableElement(target) &&
      inDrawingArea(target)
    ) {
      const msg = {
        type: "delete",
        id: target.id,
      };
      runtime.drawAndSend(msg);
    }
  }

  function stopErasing() {
    erasing = false;
  }

  function draw(data) {
    let elem;
    switch (data.type) {
      case "delete":
        if (!data.id) {
          console.error("Eraser: Missing id for delete message.", data);
          break;
        }
        elem = runtime.svgElement.getElementById(data.id);
        if (elem === null)
          console.error(
            "Eraser: Tried to delete an element that does not exist.",
          );
        else if (!runtime.drawingArea) {
          throw new Error("Eraser: Missing drawing area.");
        } else {
          runtime.drawingArea.removeChild(elem);
        }
        break;
      default:
        console.error("Eraser: 'delete' instruction with unknown type. ", data);
        break;
    }
  }

  return {
    name: "Eraser",
    shortcut: "e",
    listeners: {
      press: startErasing,
      move: erase,
      release: stopErasing,
    },
    draw: draw,
    icon: "tools/eraser/icon.svg",
    mouseCursor: "crosshair",
    showMarker: true,
  };
}
