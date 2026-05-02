const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { installTestConsole } = require("./test_console.js");
const MessageToolMetadata = require("../client-data/js/message_tool_metadata.js");
const {
  getToolModuleImportPath,
  getToolRuntimeAssetPath,
} = require("../client-data/tools/tool-defaults.js");
const { TOOL_CODE_BY_ID } = require("../client-data/tools/tool-order.js");
const PencilTool = require("../client-data/tools/pencil/index.js");
const RectangleTool = require("../client-data/tools/rectangle/index.js");
const ShapeTool = require("../client-data/tools/shape_tool.js");
installTestConsole();
const { MutationType } = MessageToolMetadata;
/** @typedef {import("../types/app-runtime").ToolModule} ToolModule */
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
 * @param {any} element
 */
function createElementClassList(element) {
  const readNames = () =>
    String(element.attributes.class || "")
      .split(/\s+/)
      .filter(Boolean);
  /** @param {string[]} names */
  const writeNames = (names) => {
    element.attributes.class = names.join(" ");
  };
  return {
    /** @param {string} name */
    add(name) {
      const names = readNames();
      if (!names.includes(name)) {
        names.push(name);
        writeNames(names);
      }
    },
    /** @param {string} name */
    remove(name) {
      writeNames(readNames().filter((candidate) => candidate !== name));
    },
    /** @param {string} name */
    contains(name) {
      return readNames().includes(name);
    },
    /**
     * @param {string} name
     * @param {boolean} [force]
     */
    toggle(name, force) {
      const enabled = force === undefined ? !this.contains(name) : force;
      if (enabled) this.add(name);
      else this.remove(name);
      return enabled;
    },
  };
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
      if (name === "id") this.id = String(value);
    },
    setAttributeNS: function (
      /** @type {string | null} */ namespace,
      /** @type {string} */ name,
      /** @type {any} */ value,
    ) {
      void namespace;
      this.setAttribute(name, value);
    },
    getAttribute: function (/** @type {string} */ name) {
      return this.attributes[name];
    },
    removeAttribute: function (/** @type {string} */ name) {
      delete this.attributes[name];
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
  element.classList = createElementClassList(element);
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
  globalAny.SVGGElement = function SVGGElement() {};
  globalAny.SVGTextElement = function SVGTextElement() {};
  globalAny.KeyboardEvent = function KeyboardEvent() {};
  globalAny.SVGTransform = {
    SVG_TRANSFORM_MATRIX: 1,
  };
  globalAny.document = {
    createElement: (/** @type {string} */ tagName) =>
      createBaseElement(store, tagName),
    createElementNS: (
      /** @type {string} */ namespace,
      /** @type {string} */ tagName,
    ) => {
      void namespace;
      return createSVGElement(store, tagName);
    },
    getElementById: (/** @type {string} */ id) => store.get(id),
    documentElement: {
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 1024,
      clientHeight: 768,
    },
  };
  globalAny.document.scrollingElement = globalAny.document.documentElement;
  globalAny.innerWidth = 1024;
  globalAny.innerHeight = 768;

  globalAny.Tools = {
    dom: {
      status: "attached",
      board: board,
      svg: svg,
      drawingArea: drawingArea,
      createSVGElement: (
        /** @type {string} */ tagName,
        /** @type {Record<string, string | number>} */ attrs,
      ) => createSVGElement(store, tagName, attrs),
      positionElement: (
        /** @type {HTMLElement} */ elem,
        /** @type {number} */ x,
        /** @type {number} */ y,
      ) => {
        elem.style.left = `${x}px`;
        elem.style.top = `${y}px`;
      },
      clearBoardCursors: () => {},
      resetBoardViewport: () => {},
    },
    svg: svg,
    board: board,
    drawingArea: drawingArea,
    access: {
      boardState: {
        readonly: false,
        canWrite: true,
      },
      readOnly: false,
      canWrite: true,
    },
    interaction: createTestInteraction(),
    sentMessages: [],
    config: {
      serverConfig: {
        RATE_LIMITS: {
          general: {
            limit: 10,
            periodMs: 1000,
          },
        },
        AUTO_FINGER_WHITEOUT: false,
        BLOCKED_SELECTION_BUTTONS: [],
      },
    },
    toolRegistry: {
      current: { secondary: { active: false } },
      change: (/** @type {string} */ toolName) => {
        globalAny.Tools.toolRegistry.current = tools[toolName];
        return true;
      },
    },
    preferences: {
      getColor: () => "#123456",
      getSize: () => 4,
      setSize: (/** @type {number | string | null | undefined} */ size) =>
        Number(size) || 4,
      getOpacity: () => 1,
    },
    ids: {
      generateUID: (/** @type {string} */ prefix) => `${prefix}-1`,
    },
    coordinates: {
      toBoardCoordinate: (/** @type {unknown} */ value) =>
        Math.round(Number(value) || 0),
      pageCoordinateToBoard: (/** @type {unknown} */ value) =>
        Math.round(Number(value) || 0),
    },
    rateLimits: {
      getEffectiveRateLimit: (/** @type {string} */ kind) => {
        const definition =
          globalAny.Tools.config.serverConfig.RATE_LIMITS[kind];
        if (!definition) throw new Error(`Missing rate limit for ${kind}`);
        return definition;
      },
    },
    viewportState: {
      scale: 1,
      drawToolsAllowed: null,
      controller: {
        ensuredBounds: /** @type {any[]} */ ([]),
        setScale: (/** @type {number} */ scale) => {
          globalAny.Tools.viewportState.scale = scale;
          return scale;
        },
        getScale: () => globalAny.Tools.viewportState.scale,
        syncLayoutSize: () => {},
        setTouchPolicy: () => {},
        ensureBoardExtentAtLeast: () => true,
        ensureBoardExtentForPoint: () => true,
        ensureBoardExtentForBounds: function (/** @type {any} */ bounds) {
          this.ensuredBounds.push(bounds);
          return true;
        },
        pageCoordinateToBoard: (/** @type {unknown} */ value) =>
          globalAny.Tools.coordinates.pageCoordinateToBoard(value),
        panBy: () => {},
        panTo: () => {},
        zoomAt: (/** @type {number} */ scale) => {
          globalAny.Tools.viewportState.scale = scale;
          return scale;
        },
        zoomBy: (/** @type {number} */ factor) => {
          globalAny.Tools.viewportState.scale *= factor;
          return globalAny.Tools.viewportState.scale;
        },
        beginPan: () => {},
        movePan: () => {},
        endPan: () => {},
        install: () => {},
        installHashObservers: () => {},
        applyFromHash: () => {},
      },
    },
    writes: {
      drawAndSend: (/** @type {any} */ data) => {
        const toolName = MessageToolMetadata.getToolId(data.tool);
        if (!toolName) throw new Error(`Unknown tool '${data.tool}'.`);
        const mountedTool =
          tools[toolName] ||
          (globalAny.Tools.toolRegistry.current?.name === toolName
            ? globalAny.Tools.toolRegistry.current
            : null);
        if (!mountedTool)
          throw new Error(`Missing mounted tool '${toolName}'.`);
        mountedTool.draw(data, true);
        globalAny.Tools.sentMessages.push({
          toolName,
          data,
        });
        return true;
      },
      send: (/** @type {any} */ data) => {
        const toolName = MessageToolMetadata.getToolId(data.tool);
        if (!toolName) throw new Error(`Unknown tool '${data.tool}'.`);
        globalAny.Tools.sentMessages.push({
          toolName,
          data,
        });
        return true;
      },
      canBufferWrites: () => true,
      whenBoardWritable: () => Promise.resolve(),
    },
    messages: {
      messageForTool: (/** @type {any} */ data) => {
        const toolName = MessageToolMetadata.getToolId(data.tool);
        if (!toolName) throw new Error(`Unknown tool '${data.tool}'.`);
        const mountedTool = tools[toolName];
        if (!mountedTool)
          throw new Error(`Missing mounted tool '${toolName}'.`);
        mountedTool.draw(data, false);
      },
    },
    identity: {
      boardName: "test-board",
      token: null,
    },
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
      const moduleNamespace = /** @type {ToolModule} */ (require(toolPath));
      const toolState = await moduleNamespace.boot(
        createToolBootContext(
          createHarnessToolRuntime(globalAny.Tools),
          (assetFile) => getToolRuntimeAssetPath(toolName, assetFile),
        ),
      );
      const stateMetadata =
        /** @type {{shortcut?: string, oneTouch?: boolean, alwaysOn?: boolean, mouseCursor?: string, helpText?: string, showMarker?: boolean, secondary?: import("../types/app-runtime").ToolSecondaryMode | null}} */ (
          toolState && typeof toolState === "object" ? toolState : {}
        );
      const press = moduleNamespace.press;
      const move = moduleNamespace.move;
      const release = moduleNamespace.release;
      const onstart = moduleNamespace.onstart;
      const onMessage = moduleNamespace.onMessage;
      const onSocketDisconnect = moduleNamespace.onSocketDisconnect;
      const onMutationRejected = moduleNamespace.onMutationRejected;
      const onSizeChange = moduleNamespace.onSizeChange;
      const getTouchPolicy = moduleNamespace.getTouchPolicy;
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
        press: press
          ? (
              /** @type {number} */ x,
              /** @type {number} */ y,
              /** @type {any} */ evt,
              /** @type {boolean} */ isTouchEvent,
            ) => press(toolState, x, y, evt, isTouchEvent)
          : undefined,
        move: move
          ? (
              /** @type {number} */ x,
              /** @type {number} */ y,
              /** @type {any} */ evt,
              /** @type {boolean} */ isTouchEvent,
            ) => move(toolState, x, y, evt, isTouchEvent)
          : undefined,
        release: release
          ? (
              /** @type {number} */ x,
              /** @type {number} */ y,
              /** @type {any} */ evt,
              /** @type {boolean} */ isTouchEvent,
            ) => release(toolState, x, y, evt, isTouchEvent)
          : undefined,
        onstart: onstart
          ? (/** @type {any} */ oldTool) => onstart(toolState, oldTool)
          : undefined,
        onMessage: onMessage
          ? (/** @type {any} */ message) => onMessage(toolState, message)
          : undefined,
        onSocketDisconnect: onSocketDisconnect
          ? () => onSocketDisconnect(toolState)
          : undefined,
        onMutationRejected: onMutationRejected
          ? (/** @type {any} */ message, /** @type {string} */ reason) =>
              onMutationRejected(toolState, message, reason)
          : undefined,
        onSizeChange: onSizeChange
          ? (/** @type {number} */ size) => onSizeChange(toolState, size)
          : undefined,
        getTouchPolicy: getTouchPolicy
          ? () => getTouchPolicy(toolState)
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

function createTestInteraction() {
  return {
    drawingEvent: false,
    showMarker: true,
    showOtherCursors: true,
    showMyCursor: true,
    activeLeaseCount: 0,
    leaseOptions: /** @type {{suppressOwnCursor?: boolean}[]} */ ([]),
    /** @param {{suppressOwnCursor?: boolean}} options */
    acquire(options) {
      this.leaseOptions.push({ ...options });
      this.activeLeaseCount += 1;
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          this.activeLeaseCount -= 1;
        },
      };
    },
    isOwnCursorSuppressed() {
      return this.activeLeaseCount > 0;
    },
  };
}

/**
 * @param {Partial<any>} [overrides]
 * @returns {any}
 */
function createInputTools(overrides = {}) {
  const tools = {
    sentMessages:
      /** @type {{toolName: string | undefined, data: any}[]} */ ([]),
    writes: /** @type {ToolRuntimeModules["writes"] | undefined} */ (undefined),
    config: {
      serverConfig: {
        RATE_LIMITS: {
          general: {
            limit: 10,
            periodMs: 1000,
          },
        },
        AUTO_FINGER_WHITEOUT: false,
      },
    },
    access: {
      boardState: {
        readonly: false,
        canWrite: true,
      },
      readOnly: false,
      canWrite: true,
    },
    preferences: {
      getColor: () => "#123456",
      getSize: () => 4,
      setSize: (/** @type {number | string | null | undefined} */ size) =>
        Number(size) || 4,
      getOpacity: () => 1,
    },
    ids: {
      generateUID: (/** @type {string} */ prefix) => `${prefix}-1`,
    },
    interaction: createTestInteraction(),
    coordinates: {
      toBoardCoordinate: (/** @type {number} */ value) => Math.round(value),
      pageCoordinateToBoard: (/** @type {number} */ value) => Math.round(value),
    },
    rateLimits: {
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
    },
    toolRegistry: {
      current: null,
      change: () => true,
    },
    ...overrides,
  };
  tools.writes = {
    drawAndSend: (/** @type {any} */ data) => {
      const toolName = MessageToolMetadata.getToolId(data.tool);
      tools.sentMessages.push({
        toolName,
        data,
      });
      return true;
    },
    send: () => unavailableCapability("writes.send"),
    canBufferWrites: () => true,
    whenBoardWritable: () => Promise.resolve(),
    ...tools.writes,
  };
  return tools;
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
    positionElement: () => unavailableCapability("board.positionElement"),
    clearBoardCursors: () => unavailableCapability("board.clearBoardCursors"),
    resetBoardViewport: () => unavailableCapability("board.resetBoardViewport"),
  };
}

/**
 * @returns {ToolRuntimeModules["coordinates"]}
 */
function createUnavailableCoordinateRuntime() {
  return {
    toBoardCoordinate: () =>
      unavailableCapability("coordinates.toBoardCoordinate"),
    pageCoordinateToBoard: () =>
      unavailableCapability("coordinates.pageCoordinateToBoard"),
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
    installTemporaryPan: () =>
      unavailableCapability("viewport.installTemporaryPan"),
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
    coordinates: tools.coordinates || createUnavailableCoordinateRuntime(),
    viewport: createUnavailableViewportRuntime(),
    writes: {
      drawAndSend: tools.writes.drawAndSend,
      send: () => unavailableCapability("writes.send"),
      canBufferWrites: () => unavailableCapability("writes.canBufferWrites"),
      whenBoardWritable: () =>
        unavailableCapability("writes.whenBoardWritable"),
    },
    identity: {
      boardName: "input-test",
      token: null,
    },
    preferences: tools.preferences,
    rateLimits: tools.rateLimits,
    toolRegistry: tools.toolRegistry,
    interaction: tools.interaction,
    config: tools.config,
    ids: tools.ids,
    messages: {
      messageForTool: () => unavailableCapability("messages.messageForTool"),
    },
    permissions: tools.access,
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
    board: app.dom,
    coordinates: app.coordinates,
    viewport: app.viewportState.controller,
    writes: app.writes,
    identity: app.identity,
    preferences: app.preferences,
    rateLimits: app.rateLimits,
    toolRegistry: app.toolRegistry,
    interaction: app.interaction,
    config: app.config,
    ids: app.ids,
    messages: app.messages,
    permissions: app.access,
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

/** @returns {any | null} */
function getPencilLiveOverlay() {
  const board = globalAny.Tools.dom.board;
  return (
    board.children.find((/** @type {any} */ child) =>
      child.classList?.contains("wbo-pencil-live-overlay"),
    ) || null
  );
}

/** @returns {any | null} */
function getPencilLiveOverlayPath() {
  return getPencilLiveOverlay()?.children?.[0] || null;
}

/** @returns {any[]} */
function drawingAreaChildren() {
  return globalAny.Tools.dom.drawingArea.children;
}

/** @returns {any[]} */
function drawingAreaPaths() {
  return drawingAreaChildren().filter(
    (/** @type {any} */ child) => child.tagName === "path",
  );
}

/**
 * @param {any} pencilTool
 */
function drawReplayStroke(pencilTool) {
  pencilTool.draw({
    tool: TOOL_CODE_BY_ID.pencil,
    type: MutationType.CREATE,
    id: "line-1",
    color: "#123456",
    size: 4,
    opacity: 1,
  });
  pencilTool.draw({
    tool: TOOL_CODE_BY_ID.pencil,
    type: MutationType.APPEND,
    parent: "line-1",
    x: 100,
    y: 200,
  });
  pencilTool.draw({
    tool: TOOL_CODE_BY_ID.pencil,
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
    tool: TOOL_CODE_BY_ID.pencil,
    type: MutationType.APPEND,
    parent: "line-1",
    x: 100,
    y: 200,
  });
  pencilTool.draw({
    tool: TOOL_CODE_BY_ID.pencil,
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
    tool: TOOL_CODE_BY_ID.pencil,
    type: MutationType.CREATE,
    id: "line-1",
    color: "#123456",
    size: 4,
    opacity: 0.5,
  });

  pencilTool.draw({
    tool: TOOL_CODE_BY_ID.pencil,
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
    tool: TOOL_CODE_BY_ID.pencil,
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
    tool: TOOL_CODE_BY_ID.pencil,
    type: MutationType.APPEND,
    parent: "l-1",
    x: 100,
    y: 100,
  });
  assert.equal(throttled.appendMessage, null);
  assert.deepEqual(ready.appendMessage, {
    tool: TOOL_CODE_BY_ID.pencil,
    type: MutationType.APPEND,
    parent: "l-1",
    x: 300,
    y: 300,
  });
});

test("Pencil keeps the active local line out of the board SVG until release", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.toolRegistry.current = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  assert.equal(harness.elementsById.has("l-1"), false);
  assert.equal(drawingAreaPaths().length, 0);
  assert.equal(globalAny.Tools.interaction.activeLeaseCount, 1);
  assert.deepEqual(globalAny.Tools.interaction.leaseOptions, [
    { suppressOwnCursor: true },
  ]);

  harness.clock.now = 2;
  pencilTool.listeners.release(200, 200, event);

  const committedLine = harness.elementsById.get("l-1");
  assert.ok(committedLine);
  assert.deepEqual(committedLine.pathData, [
    { type: "M", values: [100, 100] },
    { type: "L", values: [100, 100] },
  ]);
  assert.equal(globalAny.Tools.interaction.activeLeaseCount, 0);
  assert.deepEqual(getPencilLiveOverlayPath()?.pathData, []);
});

test("Pencil live overlay coalesces active path updates into one frame", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const event = { preventDefault: () => {} };
  const frames = /** @type {Function[]} */ ([]);
  globalAny.window.requestAnimationFrame = (/** @type {Function} */ run) => {
    frames.push(run);
    return frames.length;
  };
  globalAny.window.cancelAnimationFrame = () => {};

  globalAny.Tools.toolRegistry.current = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);
  harness.clock.now = 101;
  pencilTool.listeners.move(150, 150, event);
  harness.clock.now = 202;
  pencilTool.listeners.move(200, 200, event);

  assert.equal(frames.length, 1);
  assert.equal(harness.elementsById.has("l-1"), false);
  assert.equal(drawingAreaPaths().length, 0);

  frames.shift()?.();

  const overlayPath = getPencilLiveOverlayPath();
  assert.ok(overlayPath);
  assert.equal(drawingAreaPaths().length, 0);
  assert.ok(overlayPath.pathData.length > 0);
  assert.equal(overlayPath.attributes.stroke, "#123456");
  assert.equal(getPencilLiveOverlay()?.style.transform, "scale(1)");
});

test("Pencil live overlay flush does not read document scroll", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const event = { preventDefault: () => {} };
  const frames = /** @type {Function[]} */ ([]);
  globalAny.window.requestAnimationFrame = (/** @type {Function} */ run) => {
    frames.push(run);
    return frames.length;
  };
  globalAny.window.cancelAnimationFrame = () => {};
  Object.defineProperty(globalAny.document.documentElement, "scrollLeft", {
    configurable: true,
    get() {
      throw new Error("scrollLeft should not be read during overlay flush");
    },
  });
  Object.defineProperty(globalAny.document.documentElement, "scrollTop", {
    configurable: true,
    get() {
      throw new Error("scrollTop should not be read during overlay flush");
    },
  });

  globalAny.Tools.toolRegistry.current = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  assert.equal(frames.length, 1);
  assert.doesNotThrow(() => frames.shift()?.());
});

test("Cursor skips own marker updates while interaction suppresses it", async () => {
  const harness = createHarness();
  const cursorTool = await harness.loadTool("cursor");
  const originalSetTimeout = globalAny.setTimeout;
  globalAny.setTimeout = (
    /** @type {(...args: any[]) => void} */ callback,
    /** @type {number | undefined} */ delay,
  ) => {
    if (delay === 5000) return 0;
    return originalSetTimeout(callback, delay);
  };
  const lease = globalAny.Tools.interaction.acquire({
    suppressOwnCursor: true,
  });

  try {
    cursorTool.draw({
      tool: TOOL_CODE_BY_ID.cursor,
      type: MutationType.UPDATE,
      x: 10,
      y: 20,
      color: "#123456",
      size: 4,
    });

    assert.equal(harness.elementsById.has("cursor-me"), false);

    lease.release();
    cursorTool.draw({
      tool: TOOL_CODE_BY_ID.cursor,
      type: MutationType.UPDATE,
      x: 10,
      y: 20,
      color: "#123456",
      size: 4,
    });

    assert.equal(harness.elementsById.has("cursor-me"), true);
  } finally {
    globalAny.setTimeout = originalSetTimeout;
  }
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
    tool: TOOL_CODE_BY_ID.pencil,
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

  globalAny.Tools.toolRegistry.current = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  assert.equal(harness.elementsById.has("l-1"), false);
  assert.equal(drawingAreaPaths().length, 0);

  pencilTool.onSocketDisconnect();

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.equal(globalAny.Tools.interaction.activeLeaseCount, 0);
  assert.equal(harness.elementsById.has("l-1"), false);
  assert.deepEqual(getPencilLiveOverlayPath()?.pathData, []);
  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    [MutationType.CREATE, MutationType.APPEND],
  );
});

test("Pencil rejection aborts the active stroke and sends one cleanup delete", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.toolRegistry.current = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  assert.equal(harness.elementsById.has("l-1"), false);

  pencilTool.onMutationRejected(
    { tool: TOOL_CODE_BY_ID.pencil, type: MutationType.APPEND, parent: "l-1" },
    "shape too large",
  );

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.equal(globalAny.Tools.interaction.activeLeaseCount, 0);
  assert.equal(harness.elementsById.has("l-1"), false);
  assert.deepEqual(getPencilLiveOverlayPath()?.pathData, []);
  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    [MutationType.CREATE, MutationType.APPEND, MutationType.DELETE],
  );
  assert.equal(globalAny.Tools.sentMessages[2].toolName, "eraser");
});

test("Pencil rejection after release removes the materialized stroke once", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const event = { preventDefault: () => {} };

  globalAny.Tools.toolRegistry.current = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);
  harness.clock.now = 101;
  pencilTool.listeners.release(200, 200, event);

  assert.equal(harness.elementsById.has("l-1"), true);

  const rejectedAppend = {
    tool: TOOL_CODE_BY_ID.pencil,
    type: MutationType.APPEND,
    parent: "l-1",
  };
  pencilTool.onMutationRejected(rejectedAppend, "shape too large");
  pencilTool.onMutationRejected(rejectedAppend, "shape too large");

  assert.equal(harness.elementsById.has("l-1"), false);
  assert.deepEqual(
    globalAny.Tools.sentMessages.map(
      (/** @type {any} */ message) => message.data.type,
    ),
    [
      MutationType.CREATE,
      MutationType.APPEND,
      MutationType.APPEND,
      MutationType.DELETE,
    ],
  );
});

test("Pencil replay is idempotent for the same persisted stroke", async () => {
  const harness = createHarness();
  const pencilTool = await harness.loadTool("pencil");
  const replayStroke = [
    {
      tool: TOOL_CODE_BY_ID.pencil,
      type: MutationType.CREATE,
      id: "line-1",
      color: "#123456",
      size: 4,
      opacity: 1,
    },
    {
      tool: TOOL_CODE_BY_ID.pencil,
      type: MutationType.APPEND,
      parent: "line-1",
      x: 10,
      y: 20,
    },
    {
      tool: TOOL_CODE_BY_ID.pencil,
      type: MutationType.APPEND,
      parent: "line-1",
      x: 25,
      y: 35,
    },
    {
      tool: TOOL_CODE_BY_ID.pencil,
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

  globalAny.Tools.toolRegistry.current = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  pencilTool.onMessage({
    tool: TOOL_CODE_BY_ID.eraser,
    type: MutationType.DELETE,
    id: "l-1",
  });

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.equal(globalAny.Tools.interaction.activeLeaseCount, 0);
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

  globalAny.Tools.toolRegistry.current = pencilTool;
  harness.clock.now = 0;
  pencilTool.listeners.press(100, 100, event);

  pencilTool.onMessage({
    tool: TOOL_CODE_BY_ID.clear,
    type: MutationType.CLEAR,
  });

  harness.clock.now = 101;
  pencilTool.listeners.move(200, 200, event);

  assert.equal(globalAny.Tools.interaction.activeLeaseCount, 0);
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
    tool: TOOL_CODE_BY_ID["straight-line"],
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
    tool: TOOL_CODE_BY_ID["straight-line"],
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
    tool: TOOL_CODE_BY_ID["straight-line"],
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
      tool: TOOL_CODE_BY_ID["straight-line"],
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
      tool: TOOL_CODE_BY_ID.rectangle,
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
      tool: TOOL_CODE_BY_ID.ellipse,
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
    tool: TOOL_CODE_BY_ID.rectangle,
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
    tool: TOOL_CODE_BY_ID.rectangle,
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
      tool:
        toolName === "rectangle"
          ? TOOL_CODE_BY_ID.rectangle
          : TOOL_CODE_BY_ID.ellipse,
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
    tool: TOOL_CODE_BY_ID.rectangle,
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
    tool: TOOL_CODE_BY_ID.rectangle,
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
    tool: TOOL_CODE_BY_ID.ellipse,
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
    tool: TOOL_CODE_BY_ID.ellipse,
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
    tool: TOOL_CODE_BY_ID.ellipse,
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
  globalAny.Tools.toolRegistry.current = {
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
    tool: TOOL_CODE_BY_ID.text,
    type: MutationType.CREATE,
    id: "text-1",
    color: "#123456",
    size: 24,
    opacity: 0.7,
    x: 100,
    y: 120,
  });
  textTool.draw({
    tool: TOOL_CODE_BY_ID.text,
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
  globalAny.Tools.preferences.getSize = () => 70;

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
  globalAny.Tools.preferences.getSize = () => 310;

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
      tool: TOOL_CODE_BY_ID.text,
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
      { tool: TOOL_CODE_BY_ID.text, type: MutationType.UPDATE, id: "t-1" },
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

  const rect = globalAny.Tools.dom.createSVGElement("rect");
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
    tool: TOOL_CODE_BY_ID.hand,
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
  const ensuredBounds = globalAny.Tools.viewportState.controller.ensuredBounds;
  assert.deepEqual(ensuredBounds[ensuredBounds.length - 1], {
    minX: 140,
    minY: 125,
    maxX: 200,
    maxY: 165,
  });
});

test("Hand replay expands viewport extent for transform-only updates", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");

  const rect = globalAny.Tools.dom.createSVGElement("rect");
  rect.id = "remote-rect";
  rect.x.baseVal.value = 100;
  rect.y.baseVal.value = 100;
  rect.width.baseVal.value = 60;
  rect.height.baseVal.value = 40;
  globalAny.Tools.drawingArea.appendChild(rect);

  handTool.draw(
    {
      tool: TOOL_CODE_BY_ID.hand,
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

  assert.deepEqual(globalAny.Tools.viewportState.controller.ensuredBounds, [
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

  globalAny.Tools.config.serverConfig.MAX_BOARD_SIZE = 220;

  const rect = globalAny.Tools.dom.createSVGElement("rect");
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
    globalAny.Tools.ids.generateUID = (/** @type {string} */ prefix) => {
      nextId += 1;
      return `${prefix}-${nextId}`;
    };
    const rect = globalAny.Tools.dom.createSVGElement("rect");
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
      tool: TOOL_CODE_BY_ID.hand,
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
      tool: TOOL_CODE_BY_ID.hand,
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

test("Hand selector ignores stale async selection after transform starts", async () => {
  const harness = createHarness();
  const handTool = await harness.loadTool("hand");
  const restoreIntersectionObserver = installMockIntersectionObserver(
    (target) => target.id === "r-1",
  );

  try {
    const rect = globalAny.Tools.dom.createSVGElement("rect");
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
    const pendingSelection = handTool.listeners.release(200, 200, {
      preventDefault: () => {},
      target: outsideTarget,
    });

    handTool.listeners.press(110, 110, {
      preventDefault: () => {},
      target: outsideTarget,
    });
    await pendingSelection;

    assert.doesNotThrow(() => {
      handTool.listeners.move(150, 135, {
        preventDefault: () => {},
        target: outsideTarget,
      });
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
    globalAny.Tools.ids.generateUID = (/** @type {string} */ prefix) => {
      nextId += 1;
      return `${prefix}-${nextId}`;
    };

    const selectedRect = globalAny.Tools.dom.createSVGElement("rect");
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

    const rejectedRect = globalAny.Tools.dom.createSVGElement("rect");
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
      tool: TOOL_CODE_BY_ID.hand,
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
    const rect = globalAny.Tools.dom.createSVGElement("rect");
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

  const rect1 = globalAny.Tools.dom.createSVGElement("rect");
  rect1.id = "r-1";
  globalAny.Tools.drawingArea.appendChild(rect1);

  const rect2 = globalAny.Tools.dom.createSVGElement("rect");
  rect2.id = "r-2";
  globalAny.Tools.drawingArea.appendChild(rect2);

  eraserTool.draw({
    tool: TOOL_CODE_BY_ID.eraser,
    type: MutationType.DELETE,
    id: "r-1",
  });

  assert.equal(harness.elementsById.get("r-1"), undefined);
  assert.equal(harness.elementsById.get("r-2"), rect2);
});
