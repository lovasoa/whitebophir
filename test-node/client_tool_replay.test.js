const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { installTestConsole } = require("./test_console.js");

installTestConsole();

const PENCIL_POINT_PATH = path.join(
  __dirname,
  "..",
  "client-data",
  "tools",
  "pencil",
  "wbo_pencil_point.js",
);
const TOOL_PATHS = {
  Pencil: path.join(
    __dirname,
    "..",
    "client-data",
    "tools",
    "pencil",
    "pencil.js",
  ),
  "Straight line": path.join(
    __dirname,
    "..",
    "client-data",
    "tools",
    "line",
    "line.js",
  ),
  Rectangle: path.join(
    __dirname,
    "..",
    "client-data",
    "tools",
    "rect",
    "rect.js",
  ),
  Ellipse: path.join(
    __dirname,
    "..",
    "client-data",
    "tools",
    "ellipse",
    "ellipse.js",
  ),
  Text: path.join(
    __dirname,
    "..",
    "client-data",
    "tools",
    "text",
    "text.js",
  ),
  Hand: path.join(
    __dirname,
    "..",
    "client-data",
    "tools",
    "hand",
    "hand.js",
  ),
};

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function clonePathData(pathData) {
  return pathData.map(function (seg) {
    return { type: seg.type, values: seg.values.slice() };
  });
}

function createAnimatedLength() {
  return { baseVal: { value: 0 } };
}

function createMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function createTransformList() {
  return {
    items: [],
    get numberOfItems() {
      return this.items.length;
    },
    createSVGTransformFromMatrix: function (matrix) {
      return {
        type: global.SVGTransform.SVG_TRANSFORM_MATRIX,
        matrix: matrix,
      };
    },
    appendItem: function (transform) {
      this.items.push(transform);
      this[this.items.length - 1] = transform;
      return transform;
    },
  };
}

function createElementStore(elementsById) {
  return {
    set: function (id, element) {
      if (id) elementsById.set(id, element);
    },
    get: function (id) {
      return elementsById.get(id) || null;
    },
  };
}

function attachElementId(element, store) {
  Object.defineProperty(element, "id", {
    get: function () {
      return this._id;
    },
    set: function (value) {
      this._id = value;
      store.set(value, this);
    },
    configurable: true,
    enumerable: true,
  });
}

function createBaseElement(store, tagName) {
  const element = {
    _id: "",
    tagName: tagName,
    style: {},
    attributes: {},
    parentNode: null,
    parentElement: null,
    children: [],
    textContent: "",
    appendChild: function (child) {
      child.parentNode = this;
      child.parentElement = this;
      this.children.push(child);
      if (child.id) store.set(child.id, child);
      return child;
    },
    setAttribute: function (name, value) {
      this.attributes[name] = value;
    },
    getAttribute: function (name) {
      return this.attributes[name];
    },
    addEventListener: function () {},
    removeEventListener: function () {},
    focus: function () {},
    blur: function () {},
    contains: function (target) {
      while (target) {
        if (target === this) return true;
        target = target.parentNode;
      }
      return false;
    },
    getBoundingClientRect: function () {
      return { left: 0, top: 0, height: 0 };
    },
  };
  attachElementId(element, store);
  return element;
}

function createBBoxElement(store, tagName) {
  const element = createBaseElement(store, tagName);
  element.transform = { baseVal: createTransformList() };
  element.transformedBBox = function () {
    const matrix = this.transform.baseVal.numberOfItems
      ? this.transform.baseVal[0].matrix
      : createMatrix();
    const x = this.x ? this.x.baseVal.value : 0;
    const y = this.y ? this.y.baseVal.value : 0;
    const width = this.width ? this.width.baseVal.value : 0;
    const height = this.height ? this.height.baseVal.value : 0;
    return {
      r: [x + matrix.e, y + matrix.f],
      a: [width * matrix.a, 0],
      b: [0, height * matrix.d],
    };
  };
  return element;
}

function createSVGElement(store, tagName, attrs) {
  const element = createBBoxElement(store, tagName);
  if (tagName === "path") {
    if (global.SVGPathElement) {
      Object.setPrototypeOf(element, global.SVGPathElement.prototype);
    }
    element.pathData = [];
    element.getPathData = function () {
      return clonePathData(this.pathData);
    };
    element.setPathData = function (pathData) {
      this.pathData = clonePathData(pathData);
    };
  }
  if (tagName === "line") {
    element.x1 = createAnimatedLength();
    element.y1 = createAnimatedLength();
    element.x2 = createAnimatedLength();
    element.y2 = createAnimatedLength();
  }
  if (tagName === "rect") {
    element.x = createAnimatedLength();
    element.y = createAnimatedLength();
    element.width = createAnimatedLength();
    element.height = createAnimatedLength();
  }
  if (tagName === "ellipse") {
    element.cx = createAnimatedLength();
    element.cy = createAnimatedLength();
    element.rx = createAnimatedLength();
    element.ry = createAnimatedLength();
  }
  if (tagName === "image") {
    element.x = createAnimatedLength();
    element.y = createAnimatedLength();
    element.width = createAnimatedLength();
    element.height = createAnimatedLength();
  }
  if (attrs) {
    Object.entries(attrs).forEach(function ([name, value]) {
      element.setAttribute(name, value);
      if (name === "width" && element.width) element.width.baseVal.value = Number(value);
      if (name === "height" && element.height) {
        element.height.baseVal.value = Number(value);
      }
    });
  }
  return element;
}

function createHarness() {
  const elementsById = new Map();
  const store = createElementStore(elementsById);
  const drawingArea = createBaseElement(store, "g");
  drawingArea.appendChild = function (child) {
    child.parentNode = this;
    child.parentElement = this;
    if (child.id) store.set(child.id, child);
    return child;
  };
  const svg = createBaseElement(store, "svg");
  svg.appendChild = drawingArea.appendChild.bind(svg);
  svg.getElementById = function (id) {
    return store.get(id);
  };
  svg.namespaceURI = "http://www.w3.org/2000/svg";
  svg.createSVGMatrix = function () {
    return createMatrix();
  };

  const board = createBaseElement(store, "div");
  board.appendChild = function (child) {
    child.parentNode = this;
    child.parentElement = this;
    if (child.id) store.set(child.id, child);
    return child;
  };

  const tools = {};
  const clock = { now: 0 };
  global.performance = {
    now: function () {
      return clock.now;
    },
  };
  global.window = global;
  global.window.addEventListener = function () {};
  global.window.removeEventListener = function () {};
  global.window.scrollTo = function () {};
  global.window.WBOMessageCommon = {
    truncateText: function (value) {
      return String(value);
    },
  };
  global.window.WBOBoardMessages = {
    batchCall: function (fn, args) {
      args.forEach(fn);
      return Promise.resolve();
    },
  };
  global.pointInTransformedBBox = function () {
    return false;
  };
  global.transformedBBoxIntersects = function () {
    return false;
  };
  global.SVGPathElement = function SVGPathElement() {};
  global.SVGTransform = {
    SVG_TRANSFORM_MATRIX: 1,
  };
  global.document = {
    createElement: function (tagName) {
      return createBaseElement(store, tagName);
    },
    getElementById: function (id) {
      return store.get(id);
    },
    documentElement: {
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 1024,
    },
  };
  global.innerWidth = 1024;

  global.Tools = {
    svg: svg,
    board: board,
    drawingArea: drawingArea,
    drawingEvent: false,
    scale: 1,
    canWrite: true,
    sentMessages: [],
    server_config: {
      MAX_EMIT_COUNT_PERIOD: 1000,
      MAX_EMIT_COUNT: 10,
      AUTO_FINGER_WHITEOUT: false,
      BLOCKED_SELECTION_BUTTONS: [],
    },
    curTool: { secondary: { active: false } },
    getColor: function () {
      return "#123456";
    },
    getSize: function () {
      return 4;
    },
    setSize: function () {},
    getOpacity: function () {
      return 1;
    },
    generateUID: function (prefix) {
      return prefix + "-1";
    },
    change: function () {},
    getScale: function () {
      return 1;
    },
    createSVGElement: function (tagName, attrs) {
      return createSVGElement(store, tagName, attrs);
    },
    add: function (tool) {
      tools[tool.name] = tool;
    },
    change: function (toolName) {
      this.curTool = tools[toolName];
      return true;
    },
    drawAndSend: function (data, tool) {
      if (tool == null) tool = this.curTool;
      if (!tool) throw new Error("No active tool available");
      tool.draw(data, true);
      this.sentMessages.push({
        toolName: tool.name,
        data: JSON.parse(JSON.stringify(data)),
      });
      return true;
    },
  };

  return {
    elementsById: elementsById,
    clock: clock,
    loadTool: function (toolName) {
      clearModule(TOOL_PATHS[toolName]);
      if (toolName === "Pencil") {
        clearModule(PENCIL_POINT_PATH);
        global.wboPencilPoint = require(PENCIL_POINT_PATH).wboPencilPoint;
      }
      require(TOOL_PATHS[toolName]);
      return tools[toolName];
    },
  };
}

function expectedTwoPointStroke() {
  return [
    { type: "M", values: [100, 200] },
    { type: "L", values: [100, 200] },
    { type: "C", values: [100, 200, 300, 400, 300, 400] },
  ];
}

function drawReplayStroke(pencilTool) {
  pencilTool.draw({
    type: "line",
    id: "line-1",
    color: "#123456",
    size: 4,
    opacity: 1,
  });
  pencilTool.draw({ type: "child", parent: "line-1", x: 100, y: 200 });
  pencilTool.draw({ type: "child", parent: "line-1", x: 300, y: 400 });
}

test("Pencil replay resets an existing path before reapplying children", function () {
  const harness = createHarness();
  const pencilTool = harness.loadTool("Pencil");

  drawReplayStroke(pencilTool);
  const line = harness.elementsById.get("line-1");
  assert.deepEqual(line.pathData, expectedTwoPointStroke());

  drawReplayStroke(pencilTool);

  assert.deepEqual(line.pathData, expectedTwoPointStroke());
});

test("Pencil child messages build a missing line from scratch", function () {
  const harness = createHarness();
  const pencilTool = harness.loadTool("Pencil");

  pencilTool.draw({ type: "child", parent: "line-1", x: 100, y: 200 });
  pencilTool.draw({ type: "child", parent: "line-1", x: 300, y: 400 });

  assert.deepEqual(
    harness.elementsById.get("line-1").pathData,
    expectedTwoPointStroke(),
  );
});

test("Pencil replay updates stroke styling on the reused DOM node", function () {
  const harness = createHarness();
  const pencilTool = harness.loadTool("Pencil");

  pencilTool.draw({
    type: "line",
    id: "line-1",
    color: "#123456",
    size: 4,
    opacity: 0.5,
  });

  pencilTool.draw({
    type: "line",
    id: "line-1",
    color: "#abcdef",
    size: 7,
    opacity: 0.8,
  });

  const line = harness.elementsById.get("line-1");
  assert.equal(line.attributes.stroke, "#abcdef");
  assert.equal(line.attributes["stroke-width"], "7");
  assert.equal(line.attributes.opacity, "0.8");
  assert.deepEqual(line.pathData, []);
});

test("Straight line replay refreshes endpoints and styling on an existing node", function () {
  const harness = createHarness();
  const lineTool = harness.loadTool("Straight line");

  lineTool.draw({
    type: "straight",
    id: "line-1",
    color: "#111111",
    size: 3,
    opacity: 0.5,
    x: 10,
    y: 20,
    x2: 30,
    y2: 40,
  });
  lineTool.draw({
    type: "straight",
    id: "line-1",
    color: "#abcdef",
    size: 7,
    opacity: 0.8,
    x: 100,
    y: 200,
    x2: 300,
    y2: 400,
  });

  const line = harness.elementsById.get("line-1");
  assert.equal(line.x1.baseVal.value, 100);
  assert.equal(line.y1.baseVal.value, 200);
  assert.equal(line.x2.baseVal.value, 300);
  assert.equal(line.y2.baseVal.value, 400);
  assert.equal(line.attributes.stroke, "#abcdef");
  assert.equal(line.attributes["stroke-width"], 7);
  assert.equal(line.attributes.opacity, 0.8);
});

test("Rectangle replay normalizes reverse-drag bounds on a reused node", function () {
  const harness = createHarness();
  const rectangleTool = harness.loadTool("Rectangle");

  rectangleTool.draw({
    type: "rect",
    id: "rect-1",
    color: "#123456",
    size: 4,
    opacity: 1,
    x: 200,
    y: 150,
    x2: 80,
    y2: 20,
  });

  const rect = harness.elementsById.get("rect-1");
  assert.equal(rect.x.baseVal.value, 80);
  assert.equal(rect.y.baseVal.value, 20);
  assert.equal(rect.width.baseVal.value, 120);
  assert.equal(rect.height.baseVal.value, 130);
});

test("Ellipse replay updates center and radii on a reused node", function () {
  const harness = createHarness();
  const ellipseTool = harness.loadTool("Ellipse");

  ellipseTool.draw({
    type: "ellipse",
    id: "ellipse-1",
    color: "#123456",
    size: 4,
    opacity: 1,
    x: 10,
    y: 20,
    x2: 110,
    y2: 220,
  });
  ellipseTool.draw({
    type: "update",
    id: "ellipse-1",
    x: 0,
    y: 30,
    x2: 60,
    y2: 90,
  });

  const ellipse = harness.elementsById.get("ellipse-1");
  assert.equal(ellipse.cx.baseVal.value, 30);
  assert.equal(ellipse.cy.baseVal.value, 60);
  assert.equal(ellipse.rx.baseVal.value, 30);
  assert.equal(ellipse.ry.baseVal.value, 30);
});

test("Text replay creates and then updates the same text field", function () {
  const harness = createHarness();
  const textTool = harness.loadTool("Text");

  textTool.draw({
    type: "new",
    id: "text-1",
    color: "#123456",
    size: 24,
    opacity: 0.7,
    x: 100,
    y: 120,
  });
  textTool.draw({
    type: "update",
    id: "text-1",
    txt: "hello replay",
  });

  const text = harness.elementsById.get("text-1");
  assert.equal(text.getAttribute("x"), "100");
  assert.equal(text.getAttribute("y"), "120");
  assert.equal(text.getAttribute("font-size"), "24");
  assert.equal(text.getAttribute("fill"), "#123456");
  assert.equal(text.getAttribute("opacity"), "0.7");
  assert.equal(text.textContent, "hello replay");
});

test("Hand selector sends a final transform on quick release", function () {
  const harness = createHarness();
  const handTool = harness.loadTool("Hand");

  const rect = global.Tools.createSVGElement("rect");
  rect.id = "seed-rect";
  rect.x.baseVal.value = 100;
  rect.y.baseVal.value = 100;
  rect.width.baseVal.value = 60;
  rect.height.baseVal.value = 40;
  global.Tools.drawingArea.appendChild(rect);

  handTool.secondary.active = true;
  harness.clock.now = 10;
  handTool.listeners.press(110, 110, {
    preventDefault: function () {},
    target: rect,
  });
  handTool.listeners.move(150, 135, {
    preventDefault: function () {},
    target: rect,
  });
  handTool.listeners.release(150, 135, {
    preventDefault: function () {},
    target: rect,
  });

  assert.equal(global.Tools.sentMessages.length, 1);
  assert.equal(global.Tools.sentMessages[0].toolName, "Hand");
  assert.deepEqual(global.Tools.sentMessages[0].data, {
    _children: [
      {
        type: "update",
        id: "seed-rect",
        transform: {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: 40,
          f: 25,
        },
      },
    ],
  });
});
