const test = require("node:test");
const assert = require("node:assert/strict");

const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { TOOL_CODE_BY_ID } = require("../client-data/tools/tool-order.js");

const globalAny = /** @type {any} */ (global);

class FakeElement {
  /** @param {string} id */
  constructor(id = "") {
    this.id = id;
    this.children = /** @type {FakeElement[]} */ ([]);
    this.parentNode = /** @type {FakeElement | null} */ (null);
  }

  /** @param {FakeElement} child */
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  /** @param {FakeElement | null} target */
  contains(target) {
    while (target) {
      if (target === this) return true;
      target = target.parentNode;
    }
    return false;
  }
}

class FakeSVGGraphicsElement extends FakeElement {
  /** @param {string} id */
  constructor(id = "") {
    super(id);
    this.transformedBBox =
      /** @type {undefined | (() => {r: [number, number], a: [number, number], b: [number, number]})} */ (
        undefined
      );
  }
}

class FakeSVGSVGElement extends FakeSVGGraphicsElement {
  /** @param {Map<string, FakeElement>} elementsById */
  constructor(elementsById) {
    super("canvas");
    this.elementsById = elementsById;
  }

  /** @param {string} id */
  getElementById(id) {
    return this.elementsById.get(id) || null;
  }
}

/**
 * @param {(id: string) => FakeElement | null} [documentLookup]
 */
function createPresenceEnvironment(documentLookup) {
  const previous = {
    window: globalAny.window,
    document: globalAny.document,
    SVGGraphicsElement: globalAny.SVGGraphicsElement,
  };
  const elementsById = /** @type {Map<string, FakeElement>} */ (new Map());
  const drawingArea = new FakeSVGGraphicsElement("drawingArea");
  const svg = new FakeSVGSVGElement(elementsById);

  globalAny.window = {
    innerWidth: 1024,
    innerHeight: 768,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  globalAny.SVGGraphicsElement = FakeSVGGraphicsElement;
  globalAny.document = {
    getElementById: documentLookup || ((id) => elementsById.get(id) || null),
  };

  return {
    elementsById,
    drawingArea,
    svg,
    restore() {
      Object.assign(globalAny, previous);
    },
  };
}

/**
 * @param {FakeSVGSVGElement} svg
 * @param {FakeSVGGraphicsElement} drawingArea
 * @returns {any}
 */
function createPresenceTools(svg, drawingArea) {
  return {
    i18n: {
      /** @param {string} value */
      t: (value) => value,
    },
    dom: {
      status: "attached",
      svg,
      drawingArea,
    },
    viewportState: {
      controller: {
        getScale: () => 1,
      },
    },
    connection: {
      socket: {
        id: "sock-1",
      },
    },
  };
}

function createConnectedUser() {
  return {
    socketId: "sock-1",
    userId: "user-1",
    name: "User 1",
    color: "#123456",
    size: 4,
    lastTool: "hand",
  };
}

/**
 * @param {import("../client-data/js/board_presence_module.js").PresenceModule} presence
 */
function stubPresenceRendering(presence) {
  presence.renderConnectedUsers = () => {};
}

function handUpdateMessage() {
  return {
    tool: TOOL_CODE_BY_ID.hand,
    type: MutationType.UPDATE,
    id: "rect-1",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 },
    socket: "sock-1",
  };
}

test("presence activity treats rendered focus measurement as best-effort", async () => {
  const env = createPresenceEnvironment();
  try {
    const { PresenceModule } = await import(
      "../client-data/js/board_presence_module.js"
    );
    const target = new FakeSVGGraphicsElement("rect-1");
    target.transformedBBox = () => {
      throw new Error("Missing SVG canvas.");
    };
    env.drawingArea.appendChild(target);
    env.elementsById.set(target.id, target);

    const tools = createPresenceTools(env.svg, env.drawingArea);
    const presence = new PresenceModule(() => tools);
    stubPresenceRendering(presence);
    presence.users = { "sock-1": createConnectedUser() };

    assert.doesNotThrow(() => {
      presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());
    });
    const user = presence.users["sock-1"];
    assert.ok(user);
    assert.equal(user.lastTool, "hand");
    assert.equal(user.lastFocusX, undefined);
  } finally {
    env.restore();
  }
});

test("presence focus ignores elements outside the attached drawing area", async () => {
  const outside = new FakeSVGGraphicsElement("rect-1");
  const env = createPresenceEnvironment(() => outside);
  try {
    const { PresenceModule } = await import(
      "../client-data/js/board_presence_module.js"
    );
    outside.transformedBBox = () => {
      throw new Error("outside element should not be measured");
    };
    env.elementsById.set(outside.id, outside);

    const tools = createPresenceTools(env.svg, env.drawingArea);
    const presence = new PresenceModule(() => tools);
    stubPresenceRendering(presence);
    presence.users = { "sock-1": createConnectedUser() };

    assert.doesNotThrow(() => {
      presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());
    });
    const user = presence.users["sock-1"];
    assert.ok(user);
    assert.equal(user.lastFocusX, undefined);
  } finally {
    env.restore();
  }
});

test("presence activity does not render rows while the panel is closed", async () => {
  const env = createPresenceEnvironment();
  try {
    const { PresenceModule } = await import(
      "../client-data/js/board_presence_module.js"
    );
    const tools = createPresenceTools(env.svg, env.drawingArea);
    const presence = new PresenceModule(() => tools);
    let renderCount = 0;
    presence.renderConnectedUsers = () => {
      renderCount += 1;
    };
    presence.panelOpen = false;
    presence.users = { "sock-1": createConnectedUser() };

    presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());
    presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());

    assert.equal(renderCount, 0);
    assert.ok((presence.users["sock-1"]?.pulseUntil || 0) > 0);
  } finally {
    env.restore();
  }
});

test("presence activity row rendering is coalesced while the panel is open", async () => {
  const env = createPresenceEnvironment();
  try {
    const pendingFrames = /** @type {Function[]} */ ([]);
    globalAny.window.requestAnimationFrame = (/** @type {Function} */ run) => {
      pendingFrames.push(run);
      return pendingFrames.length;
    };
    env.elementsById.set(
      "connectedUsersList",
      new FakeElement("connectedUsersList"),
    );
    const { PresenceModule } = await import(
      "../client-data/js/board_presence_module.js"
    );
    const tools = createPresenceTools(env.svg, env.drawingArea);
    const presence = new PresenceModule(() => tools);
    let renderCount = 0;
    presence.renderConnectedUsers = () => {
      renderCount += 1;
    };
    presence.panelOpen = true;
    presence.users = { "sock-1": createConnectedUser() };

    presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());
    presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());

    assert.equal(renderCount, 0);
    assert.equal(pendingFrames.length, 1);

    pendingFrames.shift()?.();

    assert.equal(renderCount, 1);
  } finally {
    env.restore();
  }
});
