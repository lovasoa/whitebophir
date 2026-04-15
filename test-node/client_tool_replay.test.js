const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { installTestConsole } = require("./test_console.js");
installTestConsole();

/**
 * @typedef {{type: string, values: number[]}} PathSegment
 * @typedef {{a: number, b: number, c: number, d: number, e: number, f: number}} MatrixState
 * @typedef {{baseVal: {value: number}}} AnimatedLength
 * @typedef {{type: number, matrix: MatrixState}} TransformEntry
 * @typedef {{
 *   items: TransformEntry[],
 *   numberOfItems: number,
 *   [index: number]: TransformEntry | undefined,
 *   createSVGTransformFromMatrix(matrix: MatrixState): TransformEntry,
 *   appendItem(transform: TransformEntry): TransformEntry,
 * }} TransformList
 * @typedef {{set(id: string, element: any): void, get(id: string): any, delete(id: string): void}} ElementStore
 * @typedef {{elementsById: Map<string, any>, clock: {now: number}, windowListeners: Map<string, Function>, loadTool(toolName: string): any}} ReplayHarness
 */

const globalAny = /** @type {any} */ (global);
let dynamicLoadSequence = 0;

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
    "straight-line",
    "straight-line.js",
  ),
  Rectangle: path.join(
    __dirname,
    "..",
    "client-data",
    "tools",
    "rectangle",
    "rectangle.js",
  ),
  Ellipse: path.join(
    __dirname,
    "..",
    "client-data",
    "tools",
    "ellipse",
    "ellipse.js",
  ),
  Text: path.join(__dirname, "..", "client-data", "tools", "text", "text.js"),
  Hand: path.join(__dirname, "..", "client-data", "tools", "hand", "hand.js"),
};

/**
 * @param {string} toolName
 * @returns {string}
 */
function toolStem(toolName) {
  return toolName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * @param {PathSegment[]} pathData
 * @returns {PathSegment[]}
 */
function clonePathData(pathData) {
  return pathData.map((seg) => ({
    type: seg.type,
    values: seg.values.slice(),
  }));
}

/** @returns {AnimatedLength} */
function createAnimatedLength() {
  return { baseVal: { value: 0 } };
}

/** @returns {MatrixState} */
function createMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/** @returns {TransformList} */
function createTransformList() {
  return {
    /** @type {TransformEntry[]} */
    items: [],
    get numberOfItems() {
      return this.items.length;
    },
    /**
     * @param {MatrixState} matrix
     * @returns {TransformEntry}
     */
    createSVGTransformFromMatrix: (matrix) => ({
      type: globalAny.SVGTransform.SVG_TRANSFORM_MATRIX,
      matrix: matrix,
    }),
    /**
     * @param {TransformEntry} transform
     * @returns {TransformEntry}
     */
    appendItem: function (transform) {
      this.items.push(transform);
      this[this.items.length - 1] = transform;
      return transform;
    },
  };
}

/**
 * @param {Map<string, any>} elementsById
 * @returns {ElementStore}
 */
function createElementStore(elementsById) {
  return {
    /**
     * @param {string} id
     * @param {any} element
     */
    set: (id, element) => {
      if (id) elementsById.set(id, element);
    },
    /**
     * @param {string} id
     * @returns {any}
     */
    get: (id) => elementsById.get(id) || null,
    /**
     * @param {string} id
     * @returns {void}
     */
    delete: (id) => {
      elementsById.delete(id);
    },
  };
}

/**
 * @param {any} element
 * @param {ElementStore} store
 */
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

/**
 * @param {ElementStore} store
 * @param {string} tagName
 * @returns {any}
 */
function createBaseElement(store, tagName) {
  const element = /** @type {any} */ ({
    _id: "",
    tagName: tagName,
    style: /** @type {{[key: string]: any}} */ ({}),
    attributes: /** @type {{[key: string]: any}} */ ({}),
    parentNode: null,
    parentElement: null,
    children: /** @type {any[]} */ ([]),
    textContent: "",
    appendChild: function (/** @type {any} */ child) {
      child.parentNode = this;
      child.parentElement = this;
      this.children.push(child);
      if (child.id) store.set(child.id, child);
      return child;
    },
    removeChild: function (/** @type {any} */ child) {
      this.children = this.children.filter(
        (/** @type {any} */ candidate) => candidate !== child,
      );
      child.parentNode = null;
      child.parentElement = null;
      if (child.id && store.get(child.id) === child) store.delete(child.id);
      return child;
    },
    setAttribute: function (
      /** @type {string} */ name,
      /** @type {any} */ value,
    ) {
      this.attributes[name] = value;
    },
    getAttribute: function (/** @type {string} */ name) {
      return this.attributes[name];
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {},
    blur: () => {},
    contains: function (/** @type {any} */ target) {
      while (target) {
        if (target === this) return true;
        target = target.parentNode;
      }
      return false;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, height: 0 }),
    cloneNode: function () {
      const clone = createSVGElement(store, this.tagName);
      clone.style = { ...this.style };
      clone.attributes = { ...this.attributes };
      clone.textContent = this.textContent;
      [
        "x",
        "y",
        "width",
        "height",
        "x1",
        "y1",
        "x2",
        "y2",
        "cx",
        "cy",
        "rx",
        "ry",
      ].forEach((name) => {
        if (this[name] && clone[name]) {
          clone[name].baseVal.value = this[name].baseVal.value;
        }
      });
      if (this.transform && clone.transform) {
        const matrix = this.transform.baseVal.numberOfItems
          ? this.transform.baseVal[0].matrix
          : createMatrix();
        clone.transform.baseVal.appendItem(
          clone.transform.baseVal.createSVGTransformFromMatrix({
            a: matrix.a,
            b: matrix.b,
            c: matrix.c,
            d: matrix.d,
            e: matrix.e,
            f: matrix.f,
          }),
        );
      }
      if (this.pathData && clone.setPathData) clone.setPathData(this.pathData);
      return clone;
    },
  });
  attachElementId(element, store);
  return element;
}

/**
 * @param {ElementStore} store
 * @param {string} tagName
 * @returns {any}
 */
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

/**
 * @param {ElementStore} store
 * @param {string} tagName
 * @param {Record<string, string | number>} [attrs]
 * @returns {any}
 */
function createSVGElement(store, tagName, attrs) {
  const element = createBBoxElement(store, tagName);
  if (tagName === "path") {
    if (globalAny.SVGPathElement) {
      Object.setPrototypeOf(element, globalAny.SVGPathElement.prototype);
    }
    /** @type {PathSegment[]} */
    element.pathData = [];
    element.getPathData = function () {
      return clonePathData(this.pathData);
    };
    /**
     * @param {PathSegment[]} pathData
     */
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
    Object.entries(attrs).forEach(([name, value]) => {
      element.setAttribute(name, value);
      if (name === "width" && element.width)
        element.width.baseVal.value = Number(value);
      if (name === "height" && element.height) {
        element.height.baseVal.value = Number(value);
      }
    });
  }
  return element;
}

/** @returns {ReplayHarness} */
function createHarness() {
  const elementsById = /** @type {Map<string, any>} */ (new Map());
  const store = createElementStore(elementsById);
  const drawingArea = createBaseElement(store, "g");
  drawingArea.appendChild = function (/** @type {any} */ child) {
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    if (child.id) store.set(child.id, child);
    return child;
  };
  const svg = createBaseElement(store, "svg");
  svg.appendChild = drawingArea.appendChild.bind(svg);
  svg.getElementById = (/** @type {string} */ id) => store.get(id);
  svg.namespaceURI = "http://www.w3.org/2000/svg";
  svg.createSVGMatrix = () => createMatrix();

  const board = createBaseElement(store, "div");
  board.appendChild = function (/** @type {any} */ child) {
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    if (child.id) store.set(child.id, child);
    return child;
  };

  const tools = /** @type {{[name: string]: any}} */ ({});
  const clock = { now: 0 };
  const windowListeners = /** @type {Map<string, Function>} */ (new Map());
  globalAny.performance = {
    now: () => clock.now,
  };
  globalAny.window = globalAny;
  globalAny.window.addEventListener = (
    /** @type {string} */ eventName,
    /** @type {Function} */ listener,
  ) => {
    windowListeners.set(eventName, listener);
  };
  globalAny.window.removeEventListener = (
    /** @type {string} */ eventName,
    /** @type {Function} */ listener,
  ) => {
    if (windowListeners.get(eventName) === listener) {
      windowListeners.delete(eventName);
    }
  };
  globalAny.window.scrollTo = () => {};
  globalAny.window.requestAnimationFrame = (
    /** @type {(time: number) => void} */ callback,
  ) =>
    globalAny.setTimeout(() => {
      callback(globalAny.Tools.clock?.now || 0);
    }, 0);
  globalAny.window.cancelAnimationFrame = (/** @type {number} */ id) => {
    globalAny.clearTimeout(id);
  };
  globalAny.requestAnimationFrame = globalAny.window.requestAnimationFrame;
  globalAny.cancelAnimationFrame = globalAny.window.cancelAnimationFrame;
  globalAny.SVGPathElement = function SVGPathElement() {};
  globalAny.SVGGraphicsElement = function SVGGraphicsElement() {};
  globalAny.SVGSVGElement = function SVGSVGElement() {};
  globalAny.SVGTransform = {
    SVG_TRANSFORM_MATRIX: 1,
  };
  globalAny.document = {
    createElement: (/** @type {string} */ tagName) =>
      createBaseElement(store, tagName),
    getElementById: (/** @type {string} */ id) => store.get(id),
    documentElement: {
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 1024,
    },
  };
  globalAny.innerWidth = 1024;

  globalAny.Tools = {
    svg: svg,
    board: board,
    drawingArea: drawingArea,
    drawingEvent: false,
    scale: 1,
    canWrite: true,
    sentMessages: [],
    server_config: {
      RATE_LIMITS: {
        general: {
          limit: 10,
          periodMs: 1000,
        },
      },
      AUTO_FINGER_WHITEOUT: false,
      BLOCKED_SELECTION_BUTTONS: [],
    },
    curTool: { secondary: { active: false } },
    getColor: () => "#123456",
    getSize: () => 4,
    setSize: () => {},
    getOpacity: () => 1,
    generateUID: (/** @type {string} */ prefix) => `${prefix}-1`,
    getScale: () => 1,
    createSVGElement: (
      /** @type {string} */ tagName,
      /** @type {Record<string, string | number>} */ attrs,
    ) => createSVGElement(store, tagName, attrs),
    change: function (/** @type {string} */ toolName) {
      this.curTool = tools[toolName];
      return true;
    },
    drawAndSend: function (/** @type {any} */ data, /** @type {any} */ tool) {
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
    windowListeners: windowListeners,
    loadTool: async (toolName) => {
      const toolPaths = /** @type {{ [name: string]: string }} */ (TOOL_PATHS);
      const toolPath = /** @type {string} */ (toolPaths[toolName]);
      const toolUrl = `${pathToFileURL(toolPath).href}?cache-bust=${++dynamicLoadSequence}`;
      const moduleNamespace = await import(toolUrl);
      const ToolClass = moduleNamespace.default;
      if (typeof ToolClass?.boot !== "function") {
        throw new Error(`Missing default boot class for ${toolName}`);
      }
      const tool = await ToolClass.boot({
        toolName,
        runtime: {
          Tools: globalAny.Tools,
          activateTool: async (/** @type {string} */ name) => {
            globalAny.Tools.change(name);
            return true;
          },
          getButton: () => null,
          registerShortcut: () => {},
        },
        button: null,
        version: "",
        assetUrl: (/** @type {string} */ assetFile) =>
          `tools/${toolStem(toolName)}/${assetFile}`,
      });
      if (!tool.listeners) {
        tool.listeners = {
          press:
            typeof tool.press === "function"
              ? tool.press.bind(tool)
              : undefined,
          move:
            typeof tool.move === "function" ? tool.move.bind(tool) : undefined,
          release:
            typeof tool.release === "function"
              ? tool.release.bind(tool)
              : undefined,
        };
      }
      tools[tool.name] = tool;
      return tool;
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

/**
 * @param {any} pencilTool
 */
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

test("Pencil replay resets an existing path before reapplying children", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("Pencil");

  drawReplayStroke(pencilTool);
  const line = harness.elementsById.get("line-1");
  assert.deepEqual(line.pathData, expectedTwoPointStroke());

  drawReplayStroke(pencilTool);

  assert.deepEqual(line.pathData, expectedTwoPointStroke());
});

test("Pencil replay drops stale cached path data after the DOM node is replaced", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("Pencil");

  drawReplayStroke(pencilTool);
  const originalLine = harness.elementsById.get("line-1");
  originalLine.parentNode.removeChild(originalLine);

  drawReplayStroke(pencilTool);

  const replayedLine = harness.elementsById.get("line-1");
  assert.notEqual(replayedLine, originalLine);
  assert.deepEqual(replayedLine.pathData, expectedTwoPointStroke());
});

test("Pencil child messages build a missing line from scratch", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("Pencil");

  pencilTool.draw({ type: "child", parent: "line-1", x: 100, y: 200 });
  pencilTool.draw({ type: "child", parent: "line-1", x: 300, y: 400 });

  assert.deepEqual(
    harness.elementsById.get("line-1").pathData,
    expectedTwoPointStroke(),
  );
});

test("Pencil replay updates stroke styling on the reused DOM node", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("Pencil");

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

test("Pencil input sends an initial child point without waiting for throttle", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("Pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.curTool = pencilTool;
  harness.clock.now = 0;

  pencilTool.listeners.press(100, 100, event);
  harness.clock.now = 1;
  pencilTool.listeners.move(200, 200, event);
  harness.clock.now = 2;
  pencilTool.listeners.release(200, 200, event);

  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    ["line", "child"],
  );
  assert.deepEqual(globalAny.Tools.sentMessages[1].data, {
    type: "child",
    parent: "l-1",
    x: 100,
    y: 100,
  });
});

test("Pencil input stops sending points after MAX_CHILDREN", async () => {
  const harness = createHarness();
  globalAny.Tools.server_config.MAX_CHILDREN = 2;
  const pencilTool = await harness.loadTool("Pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.curTool = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);
  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);
  harness.clock.now = 202;
  pencilTool.listeners.move(300, 300, event);
  harness.clock.now = 303;
  pencilTool.listeners.move(400, 400, event);
  harness.clock.now = 404;
  pencilTool.listeners.release(500, 500, event);

  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data,
    ),
    [
      {
        type: "line",
        id: "l-1",
        color: "#123456",
        size: 4,
        opacity: 1,
      },
      {
        type: "child",
        parent: "l-1",
        x: 100,
        y: 100,
      },
      {
        type: "child",
        parent: "l-1",
        x: 200,
        y: 200,
      },
    ],
  );
});

test("Pencil disconnect aborts the active stroke and removes the local line", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("Pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.curTool = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  assert.equal(harness.elementsById.has("l-1"), true);

  pencilTool.onSocketDisconnect();

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.equal(harness.elementsById.has("l-1"), false);
  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    ["line", "child"],
  );
});

test("Pencil delete of the active line aborts the active stroke", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("Pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.curTool = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  pencilTool.onMessage({ type: "delete", id: "l-1" });

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    ["line", "child"],
  );
});

test("Pencil clear aborts the active stroke", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("Pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.curTool = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  pencilTool.onMessage({ type: "clear" });

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    ["line", "child"],
  );
});

test("Straight line replay refreshes endpoints and styling on an existing node", async () => {
  const harness = createHarness();
  const lineTool = await harness.loadTool("Straight line");

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
  assert.equal(line.attributes["stroke-width"], "7");
  assert.equal(line.attributes.opacity, "0.8");
});

test("Straight line update recreates a missing line before applying endpoints", async () => {
  const harness = createHarness();
  const lineTool = await harness.loadTool("Straight line");

  lineTool.draw({
    type: "update",
    id: "line-1",
    x2: 300,
    y2: 400,
  });

  const line = harness.elementsById.get("line-1");
  assert.equal(line.x1.baseVal.value, 300);
  assert.equal(line.y1.baseVal.value, 400);
  assert.equal(line.x2.baseVal.value, 300);
  assert.equal(line.y2.baseVal.value, 400);
});

[
  {
    tool: "Straight line",
    updateMessage: {
      tool: "Straight line",
      type: "update",
      id: "line-1",
      x2: 300,
      y2: 400,
    },
    assertElement: (
      /** @type {{x1: any, y1: any, x2: any, y2: any}} */ element,
    ) => {
      assert.equal(element.x1.baseVal.value, 300);
      assert.equal(element.y1.baseVal.value, 400);
      assert.equal(element.x2.baseVal.value, 300);
      assert.equal(element.y2.baseVal.value, 400);
    },
  },
  {
    tool: "Rectangle",
    updateMessage: {
      tool: "Rectangle",
      type: "update",
      id: "rect-1",
      x: 60,
      y: 30,
      x2: 120,
      y2: 90,
    },
    assertElement: (
      /** @type {{x: any, y: any, width: any, height: any}} */ element,
    ) => {
      assert.equal(element.x.baseVal.value, 60);
      assert.equal(element.y.baseVal.value, 30);
      assert.equal(element.width.baseVal.value, 60);
      assert.equal(element.height.baseVal.value, 60);
    },
  },
  {
    tool: "Ellipse",
    updateMessage: {
      tool: "Ellipse",
      type: "update",
      id: "ellipse-1",
      x: 0,
      y: 30,
      x2: 60,
      y2: 90,
    },
    assertElement: (
      /** @type {{cx: any, cy: any, rx: any, ry: any}} */ element,
    ) => {
      assert.equal(element.cx.baseVal.value, 30);
      assert.equal(element.cy.baseVal.value, 60);
      assert.equal(element.rx.baseVal.value, 30);
      assert.equal(element.ry.baseVal.value, 30);
    },
  },
].forEach((caseDef) => {
  test(`${caseDef.tool} update recreates a missing shape before applying updates`, async () => {
    const harness = createHarness();
    const tool = await harness.loadTool(caseDef.tool);

    tool.draw(/** @type {any} */ (caseDef.updateMessage));

    const element = harness.elementsById.get(
      /** @type {any} */ (caseDef.updateMessage.id),
    );
    caseDef.assertElement(element);
  });
});

test("Rectangle replay normalizes reverse-drag bounds on a reused node", async () => {
  const harness = createHarness();
  const rectangleTool = await harness.loadTool("Rectangle");

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

test("Rectangle update recreates a missing shape before applying bounds", async () => {
  const harness = createHarness();
  const rectangleTool = await harness.loadTool("Rectangle");

  rectangleTool.draw({
    type: "update",
    id: "rect-1",
    x: 60,
    y: 90,
    x2: 0,
    y2: 30,
  });

  const rect = harness.elementsById.get("rect-1");
  assert.equal(rect.x.baseVal.value, 0);
  assert.equal(rect.y.baseVal.value, 30);
  assert.equal(rect.width.baseVal.value, 60);
  assert.equal(rect.height.baseVal.value, 60);
});

test("Ellipse replay updates center and radii on a reused node", async () => {
  const harness = createHarness();
  const ellipseTool = await harness.loadTool("Ellipse");

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

test("Ellipse update recreates a missing shape before applying radii", async () => {
  const harness = createHarness();
  const ellipseTool = await harness.loadTool("Ellipse");

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

test("Text replay creates and then updates the same text field", async () => {
  const harness = createHarness();
  const textTool = await harness.loadTool("Text");

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

test("Hand selector sends a final transform on quick release", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("Hand");

  const rect = globalAny.Tools.createSVGElement("rect");
  rect.id = "seed-rect";
  rect.x.baseVal.value = 100;
  rect.y.baseVal.value = 100;
  rect.width.baseVal.value = 60;
  rect.height.baseVal.value = 40;
  globalAny.Tools.drawingArea.appendChild(rect);

  handTool.secondary.active = true;
  harness.clock.now = 10;
  handTool.listeners.press(110, 110, {
    preventDefault: () => {},
    target: rect,
  });
  handTool.listeners.move(150, 135, {
    preventDefault: () => {},
    target: rect,
  });
  handTool.listeners.release(150, 135, {
    preventDefault: () => {},
    target: rect,
  });

  assert.equal(globalAny.Tools.sentMessages.length, 1);
  assert.equal(globalAny.Tools.sentMessages[0].toolName, "Hand");
  assert.deepEqual(globalAny.Tools.sentMessages[0].data, {
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

test("Hand selector keeps the original element selected after duplicate", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("Hand");
  let nextId = 1;

  globalAny.Tools.generateUID = (/** @type {string} */ prefix) => {
    nextId += 1;
    return `${prefix}-${nextId}`;
  };
  globalAny.transformedBBoxIntersects = () => true;

  const rect = globalAny.Tools.createSVGElement("rect");
  rect.id = "r-1";
  rect.x.baseVal.value = 100;
  rect.y.baseVal.value = 100;
  rect.width.baseVal.value = 60;
  rect.height.baseVal.value = 40;
  globalAny.Tools.drawingArea.appendChild(rect);

  handTool.secondary.active = true;
  handTool.secondary.switch();

  const outsideTarget = {
    parentNode: null,
    matches: () => false,
  };

  handTool.listeners.press(50, 50, {
    preventDefault: () => {},
    target: outsideTarget,
  });
  handTool.listeners.move(200, 200, {
    preventDefault: () => {},
    target: outsideTarget,
  });
  handTool.listeners.release(200, 200, {
    preventDefault: () => {},
    target: outsideTarget,
  });

  const duplicateShortcut = harness.windowListeners.get("keydown");
  assert.ok(
    duplicateShortcut,
    "selector shortcut listener should be installed",
  );
  duplicateShortcut({
    key: "d",
    target: outsideTarget,
  });

  assert.equal(globalAny.Tools.sentMessages.length, 1);
  assert.deepEqual(globalAny.Tools.sentMessages[0].data, {
    _children: [{ type: "copy", id: "r-1", newid: "r-2" }],
  });

  const originalRect = harness.elementsById.get("r-1");
  handTool.listeners.press(110, 110, {
    preventDefault: () => {},
    target: originalRect,
  });
  handTool.listeners.move(150, 135, {
    preventDefault: () => {},
    target: originalRect,
  });
  handTool.listeners.release(150, 135, {
    preventDefault: () => {},
    target: originalRect,
  });

  assert.equal(globalAny.Tools.sentMessages.length, 2);
  assert.deepEqual(globalAny.Tools.sentMessages[1].data, {
    _children: [
      {
        type: "update",
        id: "r-1",
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
