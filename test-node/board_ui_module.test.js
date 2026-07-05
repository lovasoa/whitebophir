const assert = require("node:assert/strict");
const test = require("node:test");
const {
  installBrowserHarnessForTest,
} = require("./helpers/browser_harness.js");

const getBrowserHarness = installBrowserHarnessForTest(test);

/** @param {unknown} element */
function setActiveElement(element) {
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    writable: true,
    value: element,
  });
}

class FakeElement {
  /**
   * @param {{
   *   left?: number,
   *   right?: number,
   *   top?: number,
   *   bottom?: number,
   *   width?: number,
   *   height?: number,
   * }} [rect]
   */
  constructor(rect = {}) {
    this.style = /** @type {{[key: string]: string}} */ ({});
    this.offsetWidth = rect.width || 0;
    this.offsetHeight = rect.height || 0;
    this.hover = false;
    this.focused = false;
    this.children = /** @type {Set<FakeElement>} */ (new Set());
    this.listeners =
      /** @type {Map<string, {listener: EventListener, options?: AddEventListenerOptions}[]>} */ (
        new Map()
      );
    this.rect = {
      left: rect.left || 0,
      right: rect.right || rect.left || 0,
      top: rect.top || 0,
      bottom: rect.bottom || rect.top || 0,
      width: rect.width || 0,
      height: rect.height || 0,
    };
  }

  getBoundingClientRect() {
    return this.rect;
  }

  /**
   * @param {string} type
   * @param {EventListener} listener
   * @param {AddEventListenerOptions} [options]
   */
  addEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, options });
    this.listeners.set(type, listeners);
  }

  /**
   * @param {string} type
   * @param {EventListener} listener
   */
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      listeners.filter((entry) => entry.listener !== listener),
    );
  }

  /**
   * @param {string} type
   * @param {Record<string, unknown>} [event]
   */
  dispatch(type, event = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.forEach((entry) =>
      entry.listener(/** @type {Event} */ ({ type, ...event })),
    );
  }

  /** @param {FakeElement} child */
  appendChild(child) {
    this.children.add(child);
  }

  /** @param {unknown} element */
  contains(element) {
    return (
      element === this ||
      this.children.has(/** @type {FakeElement} */ (element))
    );
  }

  /** @param {string} selector */
  matches(selector) {
    return selector === ":hover" && this.hover;
  }

  focus() {
    this.focused = true;
    setActiveElement(this);
  }
}

test("positionAnchoredPanel keeps panels inside the viewport", async () => {
  const browser = getBrowserHarness();
  browser.installClientDom({ innerWidth: 300, innerHeight: 200 });
  const { positionAnchoredPanel } = await import(
    "../client-data/js/board_ui_module.js"
  );
  const anchor = /** @type {HTMLElement} */ (
    /** @type {unknown} */ (
      new FakeElement({ left: 250, right: 290, top: 30, bottom: 70 })
    )
  );
  const panel = /** @type {HTMLElement} */ (
    /** @type {unknown} */ (new FakeElement({ width: 100, height: 80 }))
  );

  const position = positionAnchoredPanel({ anchor, panel, gap: 8, margin: 8 });

  assert.equal(position.left, 142);
  assert.equal(position.top, 30);
  assert.equal(position.maxHeight, 184);
  assert.equal(panel.style.left, "142px");
  assert.equal(panel.style.top, "30px");
  assert.equal(panel.style.maxHeight, "184px");
  assert.equal(panel.style.overflowY, "");
});

test("floating panel controller owns hover, escape, blur, and resize behavior", async () => {
  const browser = getBrowserHarness();
  browser.installClientDom({ innerWidth: 300, innerHeight: 200 });
  setActiveElement(null);
  const { createFloatingPanelController } = await import(
    "../client-data/js/board_ui_module.js"
  );
  const anchor = /** @type {HTMLElement} */ (
    /** @type {unknown} */ (new FakeElement())
  );
  const panel = /** @type {HTMLElement} */ (
    /** @type {unknown} */ (new FakeElement())
  );
  let open = false;
  let positionCount = 0;
  const controller = createFloatingPanelController({
    panel,
    isOpen: () => open,
    open: () => {
      open = true;
    },
    close: () => {
      open = false;
    },
    position: () => {
      positionCount += 1;
    },
    hoverElements: [anchor, panel],
    closeOnBlurFrom: anchor,
    restoreFocusElement: anchor,
  });

  /** @type {FakeElement} */ (/** @type {unknown} */ (anchor)).dispatch(
    "mouseenter",
  );
  assert.equal(open, true);
  assert.equal(positionCount, 1);

  browser.dispatchWindowEvent("resize");
  assert.equal(positionCount, 2);

  /** @type {FakeElement} */ (/** @type {unknown} */ (panel)).dispatch(
    "keydown",
    {
      key: "Escape",
      preventDefault() {
        this.defaultPrevented = true;
      },
    },
  );
  assert.equal(open, false);
  assert.equal(
    /** @type {FakeElement} */ (/** @type {unknown} */ (anchor)).focused,
    true,
  );

  controller.open();
  setActiveElement(null);
  /** @type {FakeElement} */ (/** @type {unknown} */ (anchor)).dispatch("blur");
  browser.flushUntilIdle();
  assert.equal(open, false);
  assert.equal(positionCount, 3);

  open = true;
  controller.destroy();
  browser.dispatchWindowEvent("resize");
  assert.equal(positionCount, 3);
});
