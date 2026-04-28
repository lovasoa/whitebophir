const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { installTestConsole } = require("./test_console.js");
const MessageToolMetadata = require("../client-data/js/message_tool_metadata.js");
const {
  getToolModuleImportPath,
  getToolRuntimeAssetPath,
} = require("../client-data/tools/tool-defaults.js");
const { ToolCodes } = require("../client-data/tools/tool-order.js");
const PencilTool = require("../client-data/tools/pencil/index.js");
const RectangleTool = require("../client-data/tools/rectangle/index.js");
const ShapeTool = require("../client-data/tools/shape_tool.js");
installTestConsole();
const { MutationType } = MessageToolMetadata;
/** @typedef {import("../types/app-runtime").ToolRuntimeModules} ToolRuntimeModules */

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
  element.getBBox = function () {
    const x = this.x ? this.x.baseVal.value : 0;
    const y = this.y ? this.y.baseVal.value : 0;
    const width = this.width ? this.width.baseVal.value : 0;
    const height = this.height ? this.height.baseVal.value : 0;
    return { x, y, width, height };
  };
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
  if (tagName === "text" && globalAny.SVGTextElement) {
    Object.setPrototypeOf(element, globalAny.SVGTextElement.prototype);
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
  globalAny.SVGTextElement = function SVGTextElement() {};
  globalAny.KeyboardEvent = function KeyboardEvent() {};
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
      clientHeight: 768,
    },
  };
  globalAny.innerWidth = 1024;
  globalAny.innerHeight = 768;

  globalAny.Tools = {
    dom: {
      status: "attached",
      board: board,
      svg: svg,
      drawingArea: drawingArea,
    },
    svg: svg,
    board: board,
    drawingArea: drawingArea,
    drawingEvent: false,
    scale: 1,
    canWrite: true,
    showMarker: true,
    showMyCursor: true,
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
    setSize: (/** @type {number | string | null | undefined} */ size) =>
      Number(size) || 4,
    getOpacity: () => 1,
    generateUID: (/** @type {string} */ prefix) => `${prefix}-1`,
    getScale: () => 1,
    toBoardCoordinate: (/** @type {unknown} */ value) =>
      Math.round(Number(value) || 0),
    pageCoordinateToBoard: (/** @type {unknown} */ value) =>
      Math.round(Number(value) || 0),
    getEffectiveRateLimit: (/** @type {string} */ kind) => {
      const definition = globalAny.Tools.server_config.RATE_LIMITS[kind];
      if (!definition) throw new Error(`Missing rate limit for ${kind}`);
      return definition;
    },
    viewport: {
      ensuredBounds: /** @type {any[]} */ ([]),
      setScale: (/** @type {number} */ scale) => {
        globalAny.Tools.scale = scale;
        return scale;
      },
      getScale: () => globalAny.Tools.getScale(),
      syncLayoutSize: () => {},
      setTouchPolicy: () => {},
      ensureBoardExtentAtLeast: () => true,
      ensureBoardExtentForPoint: () => true,
      ensureBoardExtentForBounds: function (/** @type {any} */ bounds) {
        this.ensuredBounds.push(bounds);
        return true;
      },
      pageCoordinateToBoard: (/** @type {unknown} */ value) =>
        globalAny.Tools.pageCoordinateToBoard(value),
      panBy: () => {},
      panTo: () => {},
      zoomAt: (/** @type {number} */ scale) => {
        globalAny.Tools.scale = scale;
        return scale;
      },
      zoomBy: (/** @type {number} */ factor) => {
        globalAny.Tools.scale *= factor;
        return globalAny.Tools.scale;
      },
      beginPan: () => {},
      movePan: () => {},
      endPan: () => {},
      install: () => {},
      installHashObservers: () => {},
      applyFromHash: () => {},
    },
    createSVGElement: (
      /** @type {string} */ tagName,
      /** @type {Record<string, string | number>} */ attrs,
    ) => createSVGElement(store, tagName, attrs),
    change: function (/** @type {string} */ toolName) {
      this.curTool = tools[toolName];
      return true;
    },
    drawAndSend: function (/** @type {any} */ data) {
      const toolName = MessageToolMetadata.getToolId(data.tool);
      if (!toolName) throw new Error(`Unknown tool '${data.tool}'.`);
      const mountedTool =
        tools[toolName] ||
        (this.curTool?.name === toolName ? this.curTool : null);
      if (!mountedTool) throw new Error(`Missing mounted tool '${toolName}'.`);
      mountedTool.draw(data, true);
      this.sentMessages.push({
        toolName,
        data,
      });
      return true;
    },
    send: function (/** @type {any} */ data) {
      return this.drawAndSend(data);
    },
    canBufferWrites: () => true,
    whenBoardWritable: () => Promise.resolve(),
    messageForTool: (/** @type {any} */ data) => {
      const toolName = MessageToolMetadata.getToolId(data.tool);
      if (!toolName) throw new Error(`Unknown tool '${data.tool}'.`);
      const mountedTool = tools[toolName];
      if (!mountedTool) throw new Error(`Missing mounted tool '${toolName}'.`);
      mountedTool.draw(data, false);
    },
    boardName: "test-board",
    token: null,
  };

  return {
    elementsById: elementsById,
    clock: clock,
    windowListeners: windowListeners,
    loadTool: async (toolName) => {
      const toolPath = path.resolve(
        __dirname,
        "..",
        "client-data",
        "tools",
        getToolModuleImportPath(toolName),
      );
      const moduleNamespace = require(toolPath);
      if (typeof moduleNamespace.boot !== "function") {
        throw new Error(`Missing boot export for ${toolName}`);
      }
      const toolState = await moduleNamespace.boot(
        createToolBootContext(
          createHarnessToolRuntime(globalAny.Tools),
          (assetFile) => getToolRuntimeAssetPath(toolName, assetFile),
        ),
      );
      const stateMetadata =
        toolState && typeof toolState === "object" ? toolState : {};
      const tool = /** @type {any} */ ({
        name: toolName,
        shortcut: moduleNamespace.shortcut || stateMetadata.shortcut,
        oneTouch: moduleNamespace.oneTouch ?? stateMetadata.oneTouch,
        alwaysOn: moduleNamespace.alwaysOn ?? stateMetadata.alwaysOn,
        mouseCursor: moduleNamespace.mouseCursor || stateMetadata.mouseCursor,
        helpText: moduleNamespace.helpText || stateMetadata.helpText,
        showMarker: moduleNamespace.showMarker ?? stateMetadata.showMarker,
        secondary: stateMetadata.secondary || moduleNamespace.secondary || null,
        draw: (/** @type {any} */ data, /** @type {boolean} */ isLocal) =>
          moduleNamespace.draw(toolState, data, isLocal),
        press:
          typeof moduleNamespace.press === "function"
            ? (
                /** @type {number} */ x,
                /** @type {number} */ y,
                /** @type {any} */ evt,
                /** @type {boolean} */ isTouchEvent,
              ) => moduleNamespace.press(toolState, x, y, evt, isTouchEvent)
            : undefined,
        move:
          typeof moduleNamespace.move === "function"
            ? (
                /** @type {number} */ x,
                /** @type {number} */ y,
                /** @type {any} */ evt,
                /** @type {boolean} */ isTouchEvent,
              ) => moduleNamespace.move(toolState, x, y, evt, isTouchEvent)
            : undefined,
        release:
          typeof moduleNamespace.release === "function"
            ? (
                /** @type {number} */ x,
                /** @type {number} */ y,
                /** @type {any} */ evt,
                /** @type {boolean} */ isTouchEvent,
              ) => moduleNamespace.release(toolState, x, y, evt, isTouchEvent)
            : undefined,
        onstart:
          typeof moduleNamespace.onstart === "function"
            ? (/** @type {any} */ oldTool) =>
                moduleNamespace.onstart(toolState, oldTool)
            : undefined,
        onMessage:
          typeof moduleNamespace.onMessage === "function"
            ? (/** @type {any} */ message) =>
                moduleNamespace.onMessage(toolState, message)
            : undefined,
        onSocketDisconnect:
          typeof moduleNamespace.onSocketDisconnect === "function"
            ? () => moduleNamespace.onSocketDisconnect(toolState)
            : undefined,
        onMutationRejected:
          typeof moduleNamespace.onMutationRejected === "function"
            ? (/** @type {any} */ message, /** @type {string} */ reason) =>
                moduleNamespace.onMutationRejected(toolState, message, reason)
            : undefined,
        onSizeChange:
          typeof moduleNamespace.onSizeChange === "function"
            ? (/** @type {number} */ size) =>
                moduleNamespace.onSizeChange(toolState, size)
            : undefined,
        getTouchPolicy:
          typeof moduleNamespace.getTouchPolicy === "function"
            ? () => moduleNamespace.getTouchPolicy(toolState)
            : undefined,
      });
      if (!tool.listeners) {
        tool.listeners = {
          press: tool.press,
          move: tool.move,
          release: tool.release,
        };
      }
      tools[tool.name] = tool;
      return tool;
    },
  };
}

/**
 * @param {Partial<any>} [overrides]
 * @returns {any}
 */
function createInputTools(overrides = {}) {
  return {
    sentMessages: [],
    server_config: {
      RATE_LIMITS: {
        general: {
          limit: 10,
          periodMs: 1000,
        },
      },
      AUTO_FINGER_WHITEOUT: false,
    },
    getColor: () => "#123456",
    getSize: () => 4,
    setSize: (/** @type {number | string | null | undefined} */ size) =>
      Number(size) || 4,
    getOpacity: () => 1,
    generateUID: (/** @type {string} */ prefix) => `${prefix}-1`,
    toBoardCoordinate: (/** @type {number} */ value) => Math.round(value),
    pageCoordinateToBoard: (/** @type {number} */ value) => Math.round(value),
    getEffectiveRateLimit: (/** @type {string} */ kind) => {
      const definition = {
        general: {
          limit: 10,
          periodMs: 1000,
        },
      }[kind];
      if (!definition) throw new Error(`Missing rate limit for ${kind}`);
      return definition;
    },
    change: () => true,
    drawAndSend: function (/** @type {any} */ data) {
      const toolName = MessageToolMetadata.getToolId(data.tool);
      this.sentMessages.push({
        toolName,
        data,
      });
      return true;
    },
    ...overrides,
  };
}

/**
 * @param {string} capability
 * @returns {never}
 */
function unavailableCapability(capability) {
  throw new Error(`${capability} is not available in this test runtime`);
}

/**
 * @returns {ToolRuntimeModules["board"]}
 */
function createUnavailableBoardRuntime() {
  const unavailableElement = /** @type {any} */ ({});
  return {
    status: "attached",
    board: unavailableElement,
    svg: unavailableElement,
    drawingArea: unavailableElement,
    createSVGElement: () => unavailableCapability("board.createSVGElement"),
    toBoardCoordinate: () => unavailableCapability("board.toBoardCoordinate"),
    pageCoordinateToBoard: () =>
      unavailableCapability("board.pageCoordinateToBoard"),
  };
}

/**
 * @returns {ToolRuntimeModules["viewport"]}
 */
function createUnavailableViewportRuntime() {
  return {
    setScale: () => unavailableCapability("viewport.setScale"),
    getScale: () => unavailableCapability("viewport.getScale"),
    syncLayoutSize: () => unavailableCapability("viewport.syncLayoutSize"),
    setTouchPolicy: () => unavailableCapability("viewport.setTouchPolicy"),
    ensureBoardExtentAtLeast: () =>
      unavailableCapability("viewport.ensureBoardExtentAtLeast"),
    ensureBoardExtentForPoint: () =>
      unavailableCapability("viewport.ensureBoardExtentForPoint"),
    ensureBoardExtentForBounds: () =>
      unavailableCapability("viewport.ensureBoardExtentForBounds"),
    pageCoordinateToBoard: () =>
      unavailableCapability("viewport.pageCoordinateToBoard"),
    panBy: () => unavailableCapability("viewport.panBy"),
    panTo: () => unavailableCapability("viewport.panTo"),
    zoomAt: () => unavailableCapability("viewport.zoomAt"),
    zoomBy: () => unavailableCapability("viewport.zoomBy"),
    beginPan: () => unavailableCapability("viewport.beginPan"),
    movePan: () => unavailableCapability("viewport.movePan"),
    endPan: () => unavailableCapability("viewport.endPan"),
    install: () => unavailableCapability("viewport.install"),
    installHashObservers: () =>
      unavailableCapability("viewport.installHashObservers"),
    applyFromHash: () => unavailableCapability("viewport.applyFromHash"),
  };
}

/**
 * @param {any} tools
 * @returns {ToolRuntimeModules}
 */
function createInputToolRuntime(tools) {
  return {
    board: createUnavailableBoardRuntime(),
    viewport: createUnavailableViewportRuntime(),
    writes: {
      drawAndSend: (message) => tools.drawAndSend(message),
      send: () => unavailableCapability("writes.send"),
      canBufferWrites: () => unavailableCapability("writes.canBufferWrites"),
      whenBoardWritable: () =>
        unavailableCapability("writes.whenBoardWritable"),
    },
    identity: {
      boardName: "input-test",
      token: null,
    },
    preferences: {
      getColor: () => tools.getColor(),
      getSize: () => tools.getSize(),
      setSize: (size) => tools.setSize(size),
      getOpacity: () => tools.getOpacity(),
    },
    rateLimits: {
      getEffectiveRateLimit: (kind) => tools.getEffectiveRateLimit(kind),
    },
    ui: {
      getCurrentTool: () => tools.curTool || null,
      changeTool: (toolName) => tools.change(toolName),
      shouldShowMarker: () => unavailableCapability("ui.shouldShowMarker"),
      shouldShowMyCursor: () => unavailableCapability("ui.shouldShowMyCursor"),
    },
    config: {
      serverConfig: tools.server_config,
    },
    ids: {
      generateUID: (prefix, suffix) => tools.generateUID(prefix, suffix),
    },
    rendering: {
      markDrawingEvent: () => {
        tools.drawingEvent = true;
      },
    },
    messages: {
      messageForTool: () => unavailableCapability("messages.messageForTool"),
    },
    permissions: {
      canWrite: () => tools.canWrite !== false,
    },
  };
}

/**
 * @param {any} app
 * @returns {ToolRuntimeModules}
 */
function createHarnessToolRuntime(app) {
  if (app.dom?.status !== "attached") {
    throw new Error("Tool test runtime requires attached board DOM");
  }
  return {
    board: {
      ...app.dom,
      createSVGElement: (name, attrs) => app.createSVGElement(name, attrs),
      toBoardCoordinate: (value) => app.toBoardCoordinate(value),
      pageCoordinateToBoard: (value) => app.pageCoordinateToBoard(value),
    },
    viewport: app.viewport,
    writes: {
      drawAndSend: (message) => app.drawAndSend(message),
      send: (message) => app.send(message),
      canBufferWrites: () => app.canBufferWrites(),
      whenBoardWritable: () => app.whenBoardWritable(),
    },
    identity: {
      boardName: app.boardName,
      token: app.token,
    },
    preferences: {
      getColor: () => app.getColor(),
      getSize: () => app.getSize(),
      setSize: (size) => app.setSize(size),
      getOpacity: () => app.getOpacity(),
    },
    rateLimits: {
      getEffectiveRateLimit: (kind) => app.getEffectiveRateLimit(kind),
    },
    ui: {
      getCurrentTool: () => app.curTool,
      changeTool: (toolName) => app.change(toolName),
      shouldShowMarker: () => app.showMarker,
      shouldShowMyCursor: () => app.showMyCursor,
    },
    config: {
      serverConfig: app.server_config,
    },
    ids: {
      generateUID: (prefix, suffix) => app.generateUID(prefix, suffix),
    },
    rendering: {
      markDrawingEvent: () => {
        app.drawingEvent = true;
      },
    },
    messages: {
      messageForTool: (message) => app.messageForTool(message),
    },
    permissions: {
      canWrite: () => app.canWrite,
    },
  };
}

/**
 * @param {ToolRuntimeModules} runtime
 * @param {(assetFile: string) => string} assetUrl
 * @returns {import("../types/app-runtime").ToolBootContext}
 */
function createToolBootContext(runtime, assetUrl) {
  return {
    runtime,
    assetUrl,
  };
}

/**
 * @param {(target: any) => boolean} isSelected
 * @returns {() => void}
 */
function installMockIntersectionObserver(isSelected) {
  const originalIntersectionObserver = globalAny.IntersectionObserver;

  class MockIntersectionObserver {
    /**
     * @param {(entries: any[]) => void} callback
     */
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
    }

    /** @param {any} target */
    observe(target) {
      Promise.resolve().then(() => {
        if (this.disconnected) return;
        const selected = isSelected(target);
        this.callback([
          {
            target,
            isIntersecting: selected,
            intersectionRatio: selected ? 1 : 0,
            boundingClientRect: { width: 20, height: 20 },
          },
        ]);
      });
    }

    disconnect() {
      this.disconnected = true;
    }

    takeRecords() {
      return [];
    }
  }

  globalAny.IntersectionObserver = MockIntersectionObserver;
  return () => {
    globalAny.IntersectionObserver = originalIntersectionObserver;
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
    tool: ToolCodes.PENCIL,
    type: MutationType.CREATE,
    id: "line-1",
    color: "#123456",
    size: 4,
    opacity: 1,
  });
  pencilTool.draw({
    tool: ToolCodes.PENCIL,
    type: MutationType.APPEND,
    parent: "line-1",
    x: 100,
    y: 200,
  });
  pencilTool.draw({
    tool: ToolCodes.PENCIL,
    type: MutationType.APPEND,
    parent: "line-1",
    x: 300,
    y: 400,
  });
}

test("Pencil replay resets an existing path before reapplying children", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");

  drawReplayStroke(pencilTool);
  const line = harness.elementsById.get("line-1");
  assert.deepEqual(line.pathData, expectedTwoPointStroke());

  drawReplayStroke(pencilTool);

  assert.deepEqual(line.pathData, expectedTwoPointStroke());
});

test("Pencil replay drops stale cached path data after the DOM node is replaced", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");

  drawReplayStroke(pencilTool);
  const originalLine = harness.elementsById.get("line-1");
  originalLine.parentNode.removeChild(originalLine);

  drawReplayStroke(pencilTool);

  const replayedLine = harness.elementsById.get("line-1");
  assert.notEqual(replayedLine, originalLine);
  assert.deepEqual(replayedLine.pathData, expectedTwoPointStroke());
});

test("Pencil replay reuses baseline paths found via document lookup when svg lookup misses", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");

  drawReplayStroke(pencilTool);
  const originalLine = harness.elementsById.get("line-1");
  harness.elementsById.delete("line-1");
  harness.elementsById.set("line-1", originalLine);
  globalAny.Tools.svg.getElementById = () => null;

  drawReplayStroke(pencilTool);

  assert.equal(harness.elementsById.get("line-1"), originalLine);
  assert.deepEqual(originalLine.pathData, expectedTwoPointStroke());
});

test("Pencil child messages build a missing line from scratch", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");

  pencilTool.draw({
    tool: ToolCodes.PENCIL,
    type: MutationType.APPEND,
    parent: "line-1",
    x: 100,
    y: 200,
  });
  pencilTool.draw({
    tool: ToolCodes.PENCIL,
    type: MutationType.APPEND,
    parent: "line-1",
    x: 300,
    y: 400,
  });

  assert.deepEqual(
    harness.elementsById.get("line-1").pathData,
    expectedTwoPointStroke(),
  );
});

test("Pencil replay updates stroke styling on the reused DOM node", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");

  pencilTool.draw({
    tool: ToolCodes.PENCIL,
    type: MutationType.CREATE,
    id: "line-1",
    color: "#123456",
    size: 4,
    opacity: 0.5,
  });

  pencilTool.draw({
    tool: ToolCodes.PENCIL,
    type: MutationType.CREATE,
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

test("Pencil input sends an initial child point without DOM setup", () => {
  const tools = createInputTools();
  const state = PencilTool.boot(
    createToolBootContext(
      createInputToolRuntime(tools),
      (assetFile) => assetFile,
    ),
  );
  state.lastTime = 0;
  state.minPencilIntervalMs = 70;
  let preventDefaultCount = 0;
  const event = /** @type {any} */ ({
    preventDefault: () => {
      preventDefaultCount += 1;
    },
  });

  PencilTool.press(state, 100, 100, event);
  PencilTool.release(state, 200, 200);

  assert.equal(preventDefaultCount, 2);
  assert.deepEqual(
    tools.sentMessages.map((/** @type {any} */ message) => message.data.type),
    [MutationType.CREATE, MutationType.APPEND],
  );
  assert.deepEqual(tools.sentMessages[1].data, {
    tool: ToolCodes.PENCIL,
    type: MutationType.APPEND,
    parent: "l-1",
    x: 100,
    y: 100,
  });
});

test("Pencil move logic sends the first point and throttles follow-ups", () => {
  const tools = createInputTools();
  const state = PencilTool.boot(
    createToolBootContext(
      createInputToolRuntime(tools),
      (assetFile) => assetFile,
    ),
  );
  state.curLineId = "l-1";
  state.hasSentPoint = false;
  state.currentLineChildCount = 0;
  state.minPencilIntervalMs = 70;
  state.lastTime = 0;

  const first = PencilTool.createPencilMoveEffect(state, 100, 100, 0);
  state.currentLineChildCount = first.nextChildCount;
  state.hasSentPoint = first.nextHasSentPoint;
  state.lastTime = first.nextLastTime;
  const throttled = PencilTool.createPencilMoveEffect(state, 200, 200, 10);
  const ready = PencilTool.createPencilMoveEffect(state, 300, 300, 71);

  assert.deepEqual(first.appendMessage, {
    tool: ToolCodes.PENCIL,
    type: MutationType.APPEND,
    parent: "l-1",
    x: 100,
    y: 100,
  });
  assert.equal(throttled.appendMessage, null);
  assert.deepEqual(ready.appendMessage, {
    tool: ToolCodes.PENCIL,
    type: MutationType.APPEND,
    parent: "l-1",
    x: 300,
    y: 300,
  });
});

test("Pencil marks only the active local line as non-interactive while drawing", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.curTool = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  const activeLine = harness.elementsById.get("l-1");
  assert.equal(activeLine.getAttribute("class"), "wbo-pencil-drawing");

  harness.clock.now = 2;
  pencilTool.listeners.release(200, 200, event);

  assert.equal(activeLine.getAttribute("class"), "");
});

test("Pencil input logic stops at the configured child limit", () => {
  const tools = createInputTools();
  const state = PencilTool.boot(
    createToolBootContext(
      createInputToolRuntime(tools),
      (assetFile) => assetFile,
    ),
  );
  state.curLineId = "l-1";
  state.hasSentPoint = true;
  state.currentLineChildCount = 1;
  state.MAX_PENCIL_CHILDREN = 2;
  state.minPencilIntervalMs = 70;
  state.lastTime = 0;

  const finalAppend = PencilTool.createPencilMoveEffect(state, 200, 200, 101);

  assert.deepEqual(finalAppend.appendMessage, {
    tool: ToolCodes.PENCIL,
    type: MutationType.APPEND,
    parent: "l-1",
    x: 200,
    y: 200,
  });
  assert.equal(finalAppend.stopAfter, true);
  state.currentLineChildCount = finalAppend.nextChildCount;
  state.hasSentPoint = finalAppend.nextHasSentPoint;
  state.lastTime = finalAppend.nextLastTime;

  const overflow = PencilTool.createPencilMoveEffect(state, 300, 300, 202);

  assert.equal(overflow.appendMessage, null);
  assert.equal(overflow.stopBefore, true);
});

test("Pencil disconnect aborts the active stroke and removes the local line", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
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
    [MutationType.CREATE, MutationType.APPEND],
  );
});

test("Pencil rejection aborts the active stroke without removing the rolled-back line", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.curTool = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  const activeLine = harness.elementsById.get("l-1");
  assert.equal(activeLine.getAttribute("class"), "wbo-pencil-drawing");

  pencilTool.onMutationRejected(
    { tool: ToolCodes.PENCIL, type: MutationType.APPEND, parent: "l-1" },
    "shape too large",
  );

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.equal(harness.elementsById.has("l-1"), true);
  assert.equal(activeLine.getAttribute("class"), "");
  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    [MutationType.CREATE, MutationType.APPEND],
  );
});

test("Pencil replay is idempotent for the same persisted stroke", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const replayStroke = [
    {
      tool: ToolCodes.PENCIL,
      type: MutationType.CREATE,
      id: "line-1",
      color: "#123456",
      size: 4,
      opacity: 1,
    },
    {
      tool: ToolCodes.PENCIL,
      type: MutationType.APPEND,
      parent: "line-1",
      x: 10,
      y: 20,
    },
    {
      tool: ToolCodes.PENCIL,
      type: MutationType.APPEND,
      parent: "line-1",
      x: 25,
      y: 35,
    },
    {
      tool: ToolCodes.PENCIL,
      type: MutationType.APPEND,
      parent: "line-1",
      x: 40,
      y: 15,
    },
  ];

  replayStroke.forEach((message) => {
    pencilTool.draw(/** @type {any} */ (message));
  });
  const line = harness.elementsById.get("line-1");
  const firstPathData = line.getPathData();

  replayStroke.forEach((message) => {
    pencilTool.draw(/** @type {any} */ (message));
  });
  const secondPathData = line.getPathData();

  assert.deepEqual(secondPathData, firstPathData);
});

test("Pencil delete of the active line aborts the active stroke", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.curTool = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  pencilTool.onMessage({
    tool: ToolCodes.ERASER,
    type: MutationType.DELETE,
    id: "l-1",
  });

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    [MutationType.CREATE, MutationType.APPEND],
  );
});

test("Pencil clear aborts the active stroke", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.curTool = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  pencilTool.onMessage({ tool: ToolCodes.CLEAR, type: MutationType.CLEAR });

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    [MutationType.CREATE, MutationType.APPEND],
  );
});

test("Straight line replay refreshes endpoints and styling on an existing node", async () => {
  const harness = createHarness();
  const lineTool = await harness.loadTool("straight-line");

  lineTool.draw({
    tool: ToolCodes.STRAIGHT_LINE,
    type: MutationType.CREATE,
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
    tool: ToolCodes.STRAIGHT_LINE,
    type: MutationType.CREATE,
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
  const lineTool = await harness.loadTool("straight-line");

  lineTool.draw({
    tool: ToolCodes.STRAIGHT_LINE,
    type: MutationType.UPDATE,
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
    toolName: "straight-line",
    updateMessage: {
      tool: ToolCodes.STRAIGHT_LINE,
      type: MutationType.UPDATE,
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
    toolName: "rectangle",
    updateMessage: {
      tool: ToolCodes.RECTANGLE,
      type: MutationType.UPDATE,
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
    toolName: "ellipse",
    updateMessage: {
      tool: ToolCodes.ELLIPSE,
      type: MutationType.UPDATE,
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
  test(`${caseDef.toolName} update recreates a missing shape before applying updates`, async () => {
    const harness = createHarness();
    const tool = await harness.loadTool(caseDef.toolName);

    tool.draw(/** @type {any} */ (caseDef.updateMessage));

    const element = harness.elementsById.get(
      /** @type {any} */ (caseDef.updateMessage.id),
    );
    caseDef.assertElement(element);
  });
});

test("Rectangle replay normalizes reverse-drag bounds on a reused node", async () => {
  const harness = createHarness();
  const rectangleTool = await harness.loadTool("rectangle");

  rectangleTool.draw({
    tool: ToolCodes.RECTANGLE,
    type: MutationType.CREATE,
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

test("Rectangle press creates the seed message without DOM setup", () => {
  const tools = createInputTools();
  const state = RectangleTool.boot(
    createToolBootContext(
      createInputToolRuntime(tools),
      (assetFile) => assetFile,
    ),
  );
  let prevented = false;

  const event = /** @type {any} */ ({
    preventDefault: () => {
      prevented = true;
    },
  });
  RectangleTool.press(state, 80, 20, event);

  assert.equal(prevented, true);
  assert.deepEqual(tools.sentMessages[0].data, {
    tool: ToolCodes.RECTANGLE,
    type: MutationType.CREATE,
    id: "r-1",
    color: "#123456",
    size: 4,
    opacity: 1,
    x: 80,
    y: 20,
    x2: 80,
    y2: 20,
  });
});

/** @type {[string, string][]} */
const equalSpanToolCases = [
  ["rectangle", "r-1"],
  ["ellipse", "e-1"],
];

equalSpanToolCases.forEach(([toolName, id]) => {
  test(`${toolName} equal-span mode keeps update endpoints on the board`, async () => {
    const harness = createHarness();
    const tool = await harness.loadTool(toolName);

    tool.listeners.press(17136, 9240, { preventDefault: () => {} });
    tool.secondary.active = true;
    harness.clock.now = 100;
    tool.listeners.move(5105, 0, { preventDefault: () => {} });

    const updateMessage = globalAny.Tools.sentMessages[1].data;
    assert.deepEqual(updateMessage, {
      tool: toolName === "rectangle" ? ToolCodes.RECTANGLE : ToolCodes.ELLIPSE,
      type: MutationType.UPDATE,
      id,
      x: 17136,
      y: 9240,
      x2: 7896,
      y2: 0,
    });
  });
});

test("Rectangle move logic separates throttled local draw from forced send", () => {
  const tools = createInputTools();
  const state = RectangleTool.boot(
    createToolBootContext(
      createInputToolRuntime(tools),
      (assetFile) => assetFile,
    ),
  );
  state.lastTime = 0;
  state.currentShape = ShapeTool.createShapePressEffect(state, 80, 20).message;

  const throttled = ShapeTool.createShapeMoveEffect(
    state,
    120,
    90,
    undefined,
    false,
    10,
  );
  const forced = ShapeTool.createShapeMoveEffect(
    state,
    120,
    90,
    undefined,
    true,
    10,
  );

  assert.equal(throttled.shouldSend, false);
  assert.deepEqual(throttled.update, {
    tool: ToolCodes.RECTANGLE,
    type: MutationType.UPDATE,
    id: "r-1",
    x: 80,
    y: 20,
    x2: 120,
    y2: 90,
  });
  assert.equal(forced.shouldSend, true);
  assert.equal(forced.nextLastTime, 10);
});

test("Rectangle update recreates a missing shape before applying bounds", async () => {
  const harness = createHarness();
  const rectangleTool = await harness.loadTool("rectangle");

  rectangleTool.draw({
    tool: ToolCodes.RECTANGLE,
    type: MutationType.UPDATE,
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
  const ellipseTool = await harness.loadTool("ellipse");

  ellipseTool.draw({
    tool: ToolCodes.ELLIPSE,
    type: MutationType.CREATE,
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
    tool: ToolCodes.ELLIPSE,
    type: MutationType.UPDATE,
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
  const ellipseTool = await harness.loadTool("ellipse");

  ellipseTool.draw({
    tool: ToolCodes.ELLIPSE,
    type: MutationType.UPDATE,
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

async function bootTextEditorHarness() {
  const textPath = path.resolve(
    __dirname,
    "..",
    "client-data",
    "tools",
    getToolModuleImportPath("text"),
  );
  const textModule = require(textPath);
  const textState = await textModule.boot(
    createToolBootContext(
      createHarnessToolRuntime(globalAny.Tools),
      (assetFile) => getToolRuntimeAssetPath("text", assetFile),
    ),
  );
  globalAny.Tools.curTool = {
    name: "text",
    draw: (/** @type {any} */ data, /** @type {boolean} */ isLocal) =>
      textModule.draw(textState, data, isLocal),
  };
  return { textModule, textState };
}

test("Text replay creates and then updates the same text field", async () => {
  const harness = createHarness();
  const textTool = await harness.loadTool("text");

  textTool.draw({
    tool: ToolCodes.TEXT,
    type: MutationType.CREATE,
    id: "text-1",
    color: "#123456",
    size: 24,
    opacity: 0.7,
    x: 100,
    y: 120,
  });
  textTool.draw({
    tool: ToolCodes.TEXT,
    type: MutationType.UPDATE,
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

test("Text create sends an integer baseline coordinate", async () => {
  const harness = createHarness();
  const { textModule, textState } = await bootTextEditorHarness();
  globalAny.Tools.getSize = () => 70;

  textModule.press(
    textState,
    100,
    200,
    { preventDefault: () => {}, target: null },
    false,
  );
  textState.input.value = "hello";
  harness.clock.now = 200;
  textState.boundTextChangeHandler({});

  const createMessage = globalAny.Tools.sentMessages[0].data;
  assert.equal(createMessage.type, MutationType.CREATE);
  assert.equal(createMessage.size, 225);
  assert.equal(createMessage.y, 313);
});

test("Text create clamps the derived font size before sending", async () => {
  const harness = createHarness();
  const { textModule, textState } = await bootTextEditorHarness();
  globalAny.Tools.getSize = () => 310;

  textModule.press(
    textState,
    100,
    200,
    { preventDefault: () => {}, target: null },
    false,
  );
  textState.input.value = "hello";
  harness.clock.now = 200;
  textState.boundTextChangeHandler({});

  const createMessage = globalAny.Tools.sentMessages[0].data;
  assert.equal(createMessage.type, MutationType.CREATE);
  assert.equal(createMessage.size, 500);
});

test("Text remote update refreshes the active editor for the same field", async () => {
  const harness = createHarness();
  const { textModule, textState } = await bootTextEditorHarness();

  textModule.press(
    textState,
    100,
    200,
    { preventDefault: () => {}, target: null },
    false,
  );
  textState.input.value = "local draft";
  harness.clock.now = 200;
  textState.boundTextChangeHandler({});

  textModule.draw(
    textState,
    {
      tool: ToolCodes.TEXT,
      type: MutationType.UPDATE,
      id: "t-1",
      txt: "remote draft",
    },
    false,
  );

  assert.equal(textState.input.value, "remote draft");
  assert.equal(textState.curText.sentText, "remote draft");
  assert.equal(harness.elementsById.get("t-1").textContent, "remote draft");
});

test("Text rejection clears the resend timer for the active editor", async () => {
  const harness = createHarness();
  const { textModule, textState } = await bootTextEditorHarness();
  const event = { preventDefault: () => {}, target: null };
  const originalSetTimeout = globalAny.setTimeout;
  const originalClearTimeout = globalAny.clearTimeout;
  const scheduled = new Map();
  let nextTimeoutId = 1;

  globalAny.setTimeout = (/** @type {Function} */ callback) => {
    const timeoutId = nextTimeoutId++;
    scheduled.set(timeoutId, callback);
    return timeoutId;
  };
  globalAny.clearTimeout = (/** @type {number} */ timeoutId) => {
    scheduled.delete(timeoutId);
  };

  try {
    textModule.press(textState, 100, 100, event, false);
    textState.input.value = "hello";

    harness.clock.now = 200;
    textState.boundTextChangeHandler({});

    textState.input.value = "hello again";
    harness.clock.now = 250;
    textState.boundTextChangeHandler({});

    assert.equal(scheduled.size, 1);
    assert.equal(textState.curText.id, "t-1");

    textModule.onMutationRejected(
      textState,
      { tool: ToolCodes.TEXT, type: MutationType.UPDATE, id: "t-1" },
      "shape too large",
    );

    assert.equal(textState.active, false);
    assert.equal(textState.curText.timeout, null);
    assert.equal(scheduled.size, 0);
    assert.deepEqual(
      globalAny.Tools.sentMessages.map(
        (/** @type {any} */ message) => message.data.type,
      ),
      [MutationType.CREATE, MutationType.UPDATE],
    );
  } finally {
    globalAny.setTimeout = originalSetTimeout;
    globalAny.clearTimeout = originalClearTimeout;
  }
});

test("Hand selector sends a final transform on quick release", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");

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
  assert.equal(globalAny.Tools.sentMessages[0].toolName, "hand");
  assert.deepEqual(globalAny.Tools.sentMessages[0].data, {
    tool: ToolCodes.HAND,
    _children: [
      {
        type: MessageToolMetadata.MutationType.UPDATE,
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
  assert.deepEqual(globalAny.Tools.viewport.ensuredBounds.at(-1), {
    minX: 140,
    minY: 125,
    maxX: 200,
    maxY: 165,
  });
});

test("Hand replay expands viewport extent for transform-only updates", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");

  const rect = globalAny.Tools.createSVGElement("rect");
  rect.id = "remote-rect";
  rect.x.baseVal.value = 100;
  rect.y.baseVal.value = 100;
  rect.width.baseVal.value = 60;
  rect.height.baseVal.value = 40;
  globalAny.Tools.drawingArea.appendChild(rect);

  handTool.draw(
    {
      tool: ToolCodes.HAND,
      _children: [
        {
          type: MessageToolMetadata.MutationType.UPDATE,
          id: "remote-rect",
          transform: {
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            e: 400,
            f: 250,
          },
        },
      ],
    },
    false,
  );

  assert.deepEqual(globalAny.Tools.viewport.ensuredBounds, [
    {
      minX: 500,
      minY: 350,
      maxX: 560,
      maxY: 390,
    },
  ]);
});

test("Hand selector stops at the last valid transform", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");

  globalAny.Tools.server_config.MAX_BOARD_SIZE = 220;

  const rect = globalAny.Tools.createSVGElement("rect");
  rect.id = "bounded-rect";
  rect.x.baseVal.value = 100;
  rect.y.baseVal.value = 100;
  rect.width.baseVal.value = 60;
  rect.height.baseVal.value = 40;
  globalAny.Tools.drawingArea.appendChild(rect);

  handTool.secondary.active = true;
  handTool.listeners.press(110, 110, {
    preventDefault: () => {},
    target: rect,
  });
  handTool.listeners.move(200, 135, {
    preventDefault: () => {},
    target: rect,
  });
  handTool.listeners.release(200, 135, {
    preventDefault: () => {},
    target: rect,
  });

  assert.equal(globalAny.Tools.sentMessages.length, 0);
  assert.equal(rect.transform.baseVal.numberOfItems, 1);
  assert.deepEqual(rect.transform.baseVal[0].matrix, {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
  });
});

test("Hand selector keeps the original element selected after duplicate", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");
  const restoreIntersectionObserver = installMockIntersectionObserver(
    (target) => target.id === "r-1",
  );
  let nextId = 1;

  try {
    globalAny.Tools.generateUID = (/** @type {string} */ prefix) => {
      nextId += 1;
      return `${prefix}-${nextId}`;
    };
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
    await handTool.listeners.release(200, 200, {
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
      tool: ToolCodes.HAND,
      _children: [
        {
          type: MessageToolMetadata.MutationType.COPY,
          id: "r-1",
          newid: "r-2",
        },
      ],
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
      tool: ToolCodes.HAND,
      _children: [
        {
          type: MessageToolMetadata.MutationType.UPDATE,
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
  } finally {
    restoreIntersectionObserver();
  }
});

test("Hand box selection can use IntersectionObserver without target bbox reads", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");
  const restoreIntersectionObserver = installMockIntersectionObserver(
    (target) => target.id === "io-selected",
  );
  try {
    let nextId = 1;
    globalAny.Tools.generateUID = (/** @type {string} */ prefix) => {
      nextId += 1;
      return `${prefix}-${nextId}`;
    };

    const selectedRect = globalAny.Tools.createSVGElement("rect");
    selectedRect.id = "io-selected";
    selectedRect.x.baseVal.value = 100;
    selectedRect.y.baseVal.value = 100;
    selectedRect.width.baseVal.value = 60;
    selectedRect.height.baseVal.value = 40;
    selectedRect.getBBox = () => {
      throw new Error("target getBBox should not be called");
    };
    selectedRect.transformedBBox = () => {
      throw new Error("target transformedBBox should not be called");
    };
    globalAny.Tools.drawingArea.appendChild(selectedRect);

    const rejectedRect = globalAny.Tools.createSVGElement("rect");
    rejectedRect.id = "io-rejected";
    globalAny.Tools.drawingArea.appendChild(rejectedRect);

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
    await handTool.listeners.release(200, 200, {
      preventDefault: () => {},
      target: outsideTarget,
    });

    const duplicateShortcut = harness.windowListeners.get("keydown");
    assert.ok(duplicateShortcut);
    duplicateShortcut({
      key: "d",
      target: outsideTarget,
    });

    assert.deepEqual(globalAny.Tools.sentMessages[0].data, {
      tool: ToolCodes.HAND,
      _children: [
        {
          type: MessageToolMetadata.MutationType.COPY,
          id: "io-selected",
          newid: "i-2",
        },
      ],
    });
  } finally {
    restoreIntersectionObserver();
  }
});

test("Hand box selection does not fall back to target bbox reads without IntersectionObserver", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");
  const originalIntersectionObserver = globalAny.IntersectionObserver;
  globalAny.IntersectionObserver = undefined;
  try {
    const rect = globalAny.Tools.createSVGElement("rect");
    rect.id = "no-io-rect";
    rect.x.baseVal.value = 100;
    rect.y.baseVal.value = 100;
    rect.width.baseVal.value = 60;
    rect.height.baseVal.value = 40;
    rect.getBBox = () => {
      throw new Error("target getBBox should not be called");
    };
    rect.transformedBBox = () => {
      throw new Error("target transformedBBox should not be called");
    };
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
    await handTool.listeners.release(200, 200, {
      preventDefault: () => {},
      target: outsideTarget,
    });

    const duplicateShortcut = harness.windowListeners.get("keydown");
    assert.ok(duplicateShortcut);
    duplicateShortcut({
      key: "d",
      target: outsideTarget,
    });
    assert.equal(globalAny.Tools.sentMessages.length, 0);
  } finally {
    globalAny.IntersectionObserver = originalIntersectionObserver;
  }
});

test("Hand tool declares native touch scrolling when selector mode is off", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");

  assert.equal(globalAny.Tools.board.style.touchAction, undefined);
  assert.equal(globalAny.Tools.svg.style.touchAction, undefined);

  handTool.onstart?.(null);
  assert.equal(handTool.getTouchPolicy?.(), "native-pan");
  assert.equal(globalAny.Tools.board.style.touchAction, undefined);
  assert.equal(globalAny.Tools.svg.style.touchAction, undefined);

  handTool.secondary.active = true;
  handTool.secondary.switch();
  assert.equal(handTool.getTouchPolicy?.(), "app-gesture");
  assert.equal(globalAny.Tools.board.style.touchAction, undefined);
  assert.equal(globalAny.Tools.svg.style.touchAction, undefined);

  handTool.secondary.active = false;
  handTool.secondary.switch();
  assert.equal(handTool.getTouchPolicy?.(), "native-pan");
  assert.equal(globalAny.Tools.board.style.touchAction, undefined);
  assert.equal(globalAny.Tools.svg.style.touchAction, undefined);
});

test("Hand tool touch gestures do not run synthetic drag panning", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");
  let prevented = 0;

  handTool.onstart?.(null);
  handTool.listeners.press(
    0,
    0,
    {
      touches: [{ clientX: 100, clientY: 100 }],
      changedTouches: [{ clientX: 100, clientY: 100 }],
      cancelable: true,
      preventDefault: () => {
        prevented += 1;
      },
    },
    true,
  );
  handTool.listeners.move(
    0,
    0,
    {
      touches: [{ clientX: 120, clientY: 120 }],
      changedTouches: [{ clientX: 120, clientY: 120 }],
      cancelable: true,
      preventDefault: () => {
        prevented += 1;
      },
    },
    true,
  );
  handTool.listeners.release(
    0,
    0,
    {
      touches: [],
      changedTouches: [{ clientX: 120, clientY: 120 }],
      cancelable: true,
      preventDefault: () => {
        prevented += 1;
      },
    },
    true,
  );

  assert.equal(prevented, 0);
});

test("Eraser replay removes only the targeted stable id", async () => {
  const harness = createHarness();
  const eraserTool = await harness.loadTool("eraser");

  const rect1 = globalAny.Tools.createSVGElement("rect");
  rect1.id = "r-1";
  globalAny.Tools.drawingArea.appendChild(rect1);

  const rect2 = globalAny.Tools.createSVGElement("rect");
  rect2.id = "r-2";
  globalAny.Tools.drawingArea.appendChild(rect2);

  eraserTool.draw({
    tool: ToolCodes.ERASER,
    type: MutationType.DELETE,
    id: "r-1",
  });

  assert.equal(harness.elementsById.get("r-1"), undefined);
  assert.equal(harness.elementsById.get("r-2"), rect2);
});
