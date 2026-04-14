export function createTool(runtime) {
  function isEllipseElement(element) {
    return !!(
      element &&
      typeof element === "object" &&
      "cx" in element &&
      "cy" in element &&
      "rx" in element &&
      "ry" in element
    );
  }

  const curUpdate = {
    type: "update",
    id: "",
    x: 0,
    y: 0,
    x2: 0,
    y2: 0,
  };
  const lastPos = { x: 0, y: 0 };
  let lastTime = performance.now();

  function start(x, y, evt) {
    if (evt) evt.preventDefault();

    curUpdate.id = runtime.generateUID("e");

    runtime.drawAndSend({
      type: "ellipse",
      id: curUpdate.id,
      color: runtime.getColor(),
      size: runtime.getSize(),
      opacity: runtime.getOpacity(),
      x: x,
      y: y,
      x2: x,
      y2: y,
    });

    curUpdate.x = x;
    curUpdate.y = y;
  }

  function move(x, y, evt) {
    if (!curUpdate.id) return;
    if (evt) {
      circleTool.secondary.active = circleTool.secondary.active || evt.shiftKey;
      evt.preventDefault();
    }
    lastPos.x = x;
    lastPos.y = y;
    doUpdate();
  }

  function doUpdate(force) {
    if (!curUpdate.id) return;
    if (drawingCircle()) {
      const x0 = curUpdate.x,
        y0 = curUpdate.y;
      const deltaX = lastPos.x - x0,
        deltaY = lastPos.y - y0;
      const diameter = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      curUpdate.x2 = x0 + (deltaX > 0 ? diameter : -diameter);
      curUpdate.y2 = y0 + (deltaY > 0 ? diameter : -diameter);
    } else {
      curUpdate.x2 = lastPos.x;
      curUpdate.y2 = lastPos.y;
    }

    if (performance.now() - lastTime > 70 || force) {
      runtime.drawAndSend(curUpdate);
      lastTime = performance.now();
    } else {
      draw(curUpdate);
    }
  }

  function stop(x, y) {
    lastPos.x = x;
    lastPos.y = y;
    doUpdate(true);
    curUpdate.id = "";
  }

  function draw(data) {
    // runtime doesn't have drawingEvent, could just skip it or add if necessary
    // runtime.drawingEvent = true;

    switch (data.type) {
      case "ellipse":
        createShape(data);
        break;
      case "update": {
        let shape = runtime.svgElement.getElementById(data.id);
        if (!shape) {
          console.error(
            "Ellipse: Hmmm... I received an update for a shape that has not been created (%s).",
            data.id,
          );
          shape = createShape({
            id: data.id,
            x: data.x2,
            y: data.y2,
            x2: data.x2,
            y2: data.y2,
          });
        }
        updateShape(shape, data);
        break;
      }
      default:
        console.error("Ellipse: Draw instruction with unknown type. ", data);
        break;
    }
  }

  function createShape(data) {
    const existingShape = runtime.svgElement.getElementById(data.id);
    const shape = isEllipseElement(existingShape)
      ? existingShape
      : runtime.createSVGElement("ellipse");
    updateShape(shape, data);
    shape.id = data.id;
    shape.setAttribute("stroke", data.color || "black");
    shape.setAttribute("stroke-width", String(data.size || 10));
    shape.setAttribute(
      "opacity",
      String(Math.max(0.1, Math.min(1, data.opacity || 1))),
    );
    if (!runtime.drawingArea) {
      throw new Error("Ellipse: Missing drawing area.");
    }
    runtime.drawingArea.appendChild(shape);
    return shape;
  }

  function updateShape(shape, data) {
    shape.cx.baseVal.value = Math.round((data.x2 + data.x) / 2);
    shape.cy.baseVal.value = Math.round((data.y2 + data.y) / 2);
    shape.rx.baseVal.value = Math.abs(data.x2 - data.x) / 2;
    shape.ry.baseVal.value = Math.abs(data.y2 - data.y) / 2;
  }

  function drawingCircle() {
    return circleTool.secondary.active;
  }

  const circleTool = {
    name: "Ellipse",
    icon: "tools/ellipse/icon-ellipse.svg",
    secondary: {
      name: "Circle",
      icon: "tools/ellipse/icon-circle.svg",
      active: false,
      switch: () => {
        doUpdate();
      },
    },
    shortcut: "c",
    listeners: {
      press: start,
      move: move,
      release: stop,
    },
    draw: draw,
    mouseCursor: "crosshair",
    stylesheet: "tools/ellipse/ellipse.css",
  };

  return circleTool;
}
