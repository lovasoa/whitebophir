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

  /**
   * @param {string} name
   * @param {string} value
   */
  setAttribute(name, value) {
    this.attributes.set(name, value);
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

/**
 * @param {FakeDomElement} root
 * @param {string} id
 * @returns {FakeDomElement | null}
 */
function findFakeDomElementById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findFakeDomElementById(child, id);
    if (match) return match;
  }
  return null;
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

test("modal shell creates, reuses, hides, and removes shared containers", async () => {
  const browser = getBrowserHarness();
  const body = new FakeDomElement("body");
  const document = browser.installClientDom({
    globalOverrides: { HTMLElement: FakeDomElement },
    createElement: (tagName) => new FakeDomElement(tagName),
    getElementById: (id) => findFakeDomElementById(body, id),
  });
  /** @type {any} */ (document).body = body;
  const { createModalShell } = await import(
    "../client-data/js/board_ui_module.js"
  );

  const shell = createModalShell({
    overlayId: "modal-overlay",
    dialogId: "modal-dialog",
    overlayClassName: "extra-overlay another-overlay",
    dialogClassName: "extra-dialog",
    hiddenClass: "is-hidden",
    initiallyHidden: true,
  });

  assert.equal(shell.overlay.id, "modal-overlay");
  assert.equal(shell.dialog.id, "modal-dialog");
  assert.equal(shell.overlay.parentNode, body);
  assert.equal(shell.dialog.parentNode, shell.overlay);
  assert.equal(shell.overlay.classList.contains("wbo-modal-backdrop"), true);
  assert.equal(shell.overlay.classList.contains("extra-overlay"), true);
  assert.equal(shell.overlay.classList.contains("another-overlay"), true);
  assert.equal(shell.overlay.classList.contains("is-hidden"), true);
  assert.equal(shell.dialog.classList.contains("wbo-dialog"), true);
  assert.equal(shell.dialog.classList.contains("extra-dialog"), true);

  shell.show();
  assert.equal(shell.overlay.classList.contains("is-hidden"), false);
  shell.hide();
  assert.equal(shell.overlay.classList.contains("is-hidden"), true);

  const reused = createModalShell({
    overlayId: "modal-overlay",
    dialogId: "modal-dialog",
  });
  assert.equal(reused.overlay, shell.overlay);
  assert.equal(reused.dialog, shell.dialog);

  const transient = createModalShell();
  transient.hide();
  assert.equal(transient.overlay.hidden, true);
  transient.show();
  assert.equal(transient.overlay.hidden, false);
  transient.destroy();

  shell.destroy();
  assert.equal(findFakeDomElementById(body, "modal-overlay"), null);
});

test("native modal dialogs only settle on shell clicks", async () => {
  const browser = getBrowserHarness();
  const body = new FakeDomElement("body");
  const document = browser.installClientDom({
    globalOverrides: { HTMLElement: FakeDomElement },
    createElement: (tagName) => new FakeDomElement(tagName),
  });
  /** @type {any} */ (document).body = body;
  const { showChoiceDialog } = await import(
    "../client-data/js/board_ui_module.js"
  );

  const resultPromise = showChoiceDialog({
    message: "Ban user?",
    choices: [{ label: "1 hour", value: 60 * 60 * 1000 }],
  });
  let resolved = false;
  void resultPromise.then(() => {
    resolved = true;
  });

  const dialog = body.children[0];
  assert.ok(dialog);
  const panel = dialog.children[0];
  assert.ok(panel);
  assert.equal(dialog.classList.contains("wbo-native-dialog"), true);
  assert.equal(panel.classList.contains("wbo-dialog"), true);

  dialog.dispatch("click", { target: panel });
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(dialog.parentNode, body);

  dialog.dispatch("click", { target: dialog });
  assert.equal(await resultPromise, null);
  assert.equal(resolved, true);
  assert.equal(dialog.parentNode, null);
});
