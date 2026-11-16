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

class FakeElement extends EventTarget {
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
    super();
    this.style = /** @type {{[key: string]: string}} */ ({});
    this.offsetWidth = rect.width || 0;
    this.offsetHeight = rect.height || 0;
    this.hover = false;
    this.focused = false;
    this.children = /** @type {Set<FakeElement>} */ (new Set());
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
   * @param {Record<string, unknown>} [event]
   */
  dispatch(type, event = {}) {
    this.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), event),
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

class FakeDomElement {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName;
    this.id = "";
    this.className = "";
    this.hidden = false;
    this.open = false;
    this.textContent = "";
    /** @type {FakeDomElement | null} */
    this.parentNode = null;
    /** @type {FakeDomElement[]} */
    this.children = [];
    this.attributes = /** @type {Map<string, string>} */ (new Map());
    this.listeners =
      /** @type {Map<string, {listener: EventListener, options?: AddEventListenerOptions}[]>} */ (
        new Map()
      );
    const element = this;
    const classes = new Set();
    /** @type {{add: (...names: string[]) => void, remove: (...names: string[]) => void, contains: (name: string) => boolean}} */
    this.classList = {
      /** @param {...string} names */
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      /** @param {...string} names */
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      /** @param {string} name */
      contains(name) {
        return (
          classes.has(name) ||
          element.className.split(/\s+/).filter(Boolean).includes(name)
        );
      },
    };
  }

  /** @param {FakeDomElement} child */
  appendChild(child) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  /** @param {...FakeDomElement} children */
  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    for (const child of children) this.appendChild(child);
  }

  /**
   * @param {string} name
   * @param {string} value
   */
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  /** @param {string} name */
  removeAttribute(name) {
    this.attributes.delete(name);
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
      entry.listener(
        /** @type {Event} */ (
          /** @type {unknown} */ ({ type, target: this, ...event })
        ),
      ),
    );
  }

  focus() {
    this.open = true;
    setActiveElement(this);
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    this.dispatch("close");
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(
      (child) => child !== this,
    );
    this.parentNode = null;
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
  const windowEvents = new EventTarget();
  browser.setWindowProperties({
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
  });
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

  windowEvents.dispatchEvent(new Event("resize"));
  assert.equal(positionCount, 2);

  /** @type {FakeElement} */ (/** @type {unknown} */ (panel)).dispatch(
    "keydown",
    {
      key: "Escape",
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

  open = false;
  controller.destroy();
  /** @type {FakeElement} */ (/** @type {unknown} */ (anchor)).dispatch(
    "mouseenter",
  );
  assert.equal(open, false);
  open = true;
  /** @type {FakeElement} */ (/** @type {unknown} */ (panel)).dispatch(
    "keydown",
    { key: "Escape" },
  );
  assert.equal(open, true);
  windowEvents.dispatchEvent(new Event("resize"));
  assert.equal(positionCount, 3);
});

test("notice panels preserve local dismissal, delegate acknowledgement and replace content safely", async () => {
  const browser = getBrowserHarness();
  browser.installClientDom({ createElement: (tag) => new FakeDomElement(tag) });
  const { createNoticePanel } = await import(
    "../client-data/js/board_ui_module.js"
  );
  const elements = {
    panel: new FakeDomElement("section"),
    title: new FakeDomElement("h2"),
    body: new FakeDomElement("div"),
    primaryAction: new FakeDomElement("a"),
    dismissButton: new FakeDomElement("button"),
    restoreFocusElement: new FakeDomElement("button"),
  };
  const panel = createNoticePanel(
    /** @type {import("../client-data/js/board_ui_module.js").NoticePanelOptions} */ (
      /** @type {unknown} */ (elements)
    ),
  );
  let acknowledged = 0;
  const first = {
    title: "First",
    paragraphs: ["<b>Plain text</b>", "Second paragraph"],
    primaryAction: { label: "Create a private board", href: "../random" },
    onDismiss: () => acknowledged++,
  };
  const second = { title: "Second", paragraphs: ["One paragraph"] };
  panel.show(first);
  assert.equal(elements.title.textContent, "First");
  assert.equal(elements.primaryAction.hidden, false);
  assert.equal(elements.primaryAction.textContent, first.primaryAction.label);
  assert.equal(
    elements.primaryAction.attributes.get("href"),
    first.primaryAction.href,
  );
  assert.deepEqual(
    elements.body.children.map((child) => child.textContent),
    first.paragraphs,
  );
  const paragraph = elements.body.children[0];
  panel.show(first);
  assert.equal(
    elements.body.children[0],
    paragraph,
    "state refresh must not rebuild the active notice",
  );
  elements.dismissButton.dispatch("click");
  assert.equal(elements.panel.hidden, true);
  assert.equal(document.activeElement, elements.restoreFocusElement);
  assert.equal(acknowledged, 1);
  panel.show(first);
  assert.equal(
    elements.panel.hidden,
    true,
    "refresh must not reopen a dismissed notice",
  );
  panel.show(second);
  assert.equal(elements.panel.hidden, false);
  assert.equal(elements.primaryAction.hidden, true);
  assert.equal(elements.primaryAction.textContent, "");
  assert.equal(elements.primaryAction.attributes.has("href"), false);
  assert.deepEqual(
    elements.body.children.map((child) => child.textContent),
    second.paragraphs,
  );
  elements.dismissButton.dispatch("click");
  assert.equal(
    acknowledged,
    1,
    "each notice owns its own acknowledgement policy",
  );
  panel.show(null);
  assert.equal(elements.panel.hidden, true);
  panel.show(second);
  assert.equal(
    elements.panel.hidden,
    false,
    "a new occurrence must be visible",
  );
});

test("countdown durations use localized unit patterns", async () => {
  const { formatCountdownDuration } = await import(
    "../client-data/js/board_ui_module.js"
  );
  const units = {
    day: "{count}日",
    hour: "{count}時間",
    minute: "{count}分",
    second: "{count}秒",
  };

  assert.equal(formatCountdownDuration(90_061_000, units), "1日 1時間 1分");
  assert.equal(formatCountdownDuration(3_661_000, units), "1時間 1分");
  assert.equal(formatCountdownDuration(62_000, units), "1分 02秒");
  assert.equal(formatCountdownDuration(900, units), "1秒");
});
