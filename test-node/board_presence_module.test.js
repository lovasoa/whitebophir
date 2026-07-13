const test = require("node:test");
const assert = require("node:assert/strict");

const { MutationType } = require("../client-data/js/message_tool_metadata.js");
const { TOOL_CODE_BY_ID } = require("../client-data/tools/tool-order.js");
const {
  installBrowserHarnessForTest,
} = require("./helpers/browser_harness.js");

const getBrowserHarness = installBrowserHarnessForTest(test);

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
  const browser = getBrowserHarness();
  const elementsById = /** @type {Map<string, FakeElement>} */ (new Map());
  const drawingArea = new FakeSVGGraphicsElement("drawingArea");
  const svg = new FakeSVGSVGElement(elementsById);

  browser.installClientDom({
    globalOverrides: { SVGGraphicsElement: FakeSVGGraphicsElement },
    getElementById(id) {
      return documentLookup ? documentLookup(id) : elementsById.get(id) || null;
    },
  });

  return {
    elementsById,
    drawingArea,
    svg,
    time: browser,
    restore() {
      browser.restore();
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
    position: { x: 0, y: 0 },
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

test("connected user display name marks moderators consistently", async () => {
  const { getConnectedUserDisplayName } = await import(
    "../client-data/js/board_presence_module.js"
  );

  assert.equal(
    getConnectedUserDisplayName({
      ...createConnectedUser(),
      canClear: true,
    }),
    "\u{1F338} User 1",
  );
  assert.equal(
    getConnectedUserDisplayName({
      ...createConnectedUser(),
      canClear: false,
    }),
    "User 1",
  );
  assert.equal(
    getConnectedUserDisplayName({
      ...createConnectedUser(),
      friend: true,
      canClear: true,
    }),
    "\u2665\uFE0E \u{1F338} User 1",
  );
});

test("connected user display sort pins self, then friends, then other users", async () => {
  const { compareConnectedUsersForDisplay } = await import(
    "../client-data/js/board_presence_module.js"
  );
  const users = [
    { ...createConnectedUser(), socketId: "sock-2", name: "Alice" },
    { ...createConnectedUser(), socketId: "sock-1", name: "Zed" },
    {
      ...createConnectedUser(),
      socketId: "sock-3",
      name: "Bob",
      friend: true,
    },
    {
      ...createConnectedUser(),
      socketId: "sock-4",
      name: "Aaron",
      friend: true,
    },
  ];

  users.sort((left, right) =>
    compareConnectedUsersForDisplay("sock-1", left, right),
  );

  assert.deepEqual(
    users.map((user) => user.socketId),
    ["sock-1", "sock-4", "sock-3", "sock-2"],
  );
});

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
    presence.users = new Map([["sock-1", createConnectedUser()]]);

    assert.doesNotThrow(() => {
      presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());
    });
    const user = presence.users.get("sock-1");
    assert.ok(user);
    assert.equal(user.lastTool, "hand");
    assert.deepEqual(user.position, { x: 0, y: 0 });
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
    presence.users = new Map([["sock-1", createConnectedUser()]]);

    assert.doesNotThrow(() => {
      presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());
    });
    const user = presence.users.get("sock-1");
    assert.ok(user);
    assert.deepEqual(user.position, { x: 0, y: 0 });
  } finally {
    env.restore();
  }
});

test("presence activity point prefers shape drag endpoints", async () => {
  const env = createPresenceEnvironment();
  try {
    const { PresenceModule } = await import(
      "../client-data/js/board_presence_module.js"
    );
    const tools = createPresenceTools(env.svg, env.drawingArea);
    const presence = new PresenceModule(() => tools);
    stubPresenceRendering(presence);
    presence.users = new Map([["sock-1", createConnectedUser()]]);

    presence.updateConnectedUsersFromActivity("user-1", {
      tool: TOOL_CODE_BY_ID.rectangle,
      type: MutationType.UPDATE,
      id: "rect-1",
      socket: "sock-1",
      x: 10,
      y: 20,
      x2: 120,
      y2: 140,
    });

    const user = presence.users.get("sock-1");
    assert.ok(user);
    assert.equal(user.lastTool, "rectangle");
    assert.deepEqual(user.position, { x: 120, y: 140 });
  } finally {
    env.restore();
  }
});

test("cursor movement clears idle activity without pulsing the row", async () => {
  const env = createPresenceEnvironment();
  try {
    const { PresenceModule } = await import(
      "../client-data/js/board_presence_module.js"
    );
    const tools = createPresenceTools(env.svg, env.drawingArea);
    const presence = new PresenceModule(() => tools);
    stubPresenceRendering(presence);
    const user = {
      ...createConnectedUser(),
      joinedAt: Date.now() - 5 * 60 * 1000 - 1000,
    };
    presence.users = new Map([["sock-1", user]]);

    const beforeCursor = Date.now();
    presence.updateConnectedUsersFromActivity("user-1", {
      tool: TOOL_CODE_BY_ID.cursor,
      type: MutationType.UPDATE,
      socket: "sock-1",
      activeTool: "hand",
      x: 15,
      y: 25,
      color: "#123456",
      size: 4,
      opacity: 1,
    });
    const afterCursor = Date.now();

    const updatedUser = presence.users.get("sock-1");
    assert.ok(updatedUser);
    assert.ok((updatedUser.lastActivityAt || 0) >= beforeCursor);
    assert.ok((updatedUser.lastActivityAt || 0) <= afterCursor);
    assert.equal(updatedUser.pulseUntil, undefined);
    assert.deepEqual(updatedUser.position, { x: 15, y: 25 });
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
    presence.users = new Map([["sock-1", createConnectedUser()]]);

    presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());
    presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());

    assert.equal(renderCount, 0);
    assert.ok((presence.users.get("sock-1")?.pulseUntil || 0) > 0);
  } finally {
    env.restore();
  }
});

test("presence activity row rendering is coalesced while the panel is open", async () => {
  const env = createPresenceEnvironment();
  try {
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
    presence.users = new Map([["sock-1", createConnectedUser()]]);

    presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());
    presence.updateConnectedUsersFromActivity("user-1", handUpdateMessage());

    assert.equal(renderCount, 0);

    env.time.flushUntilIdle();

    assert.equal(renderCount, 1);
  } finally {
    env.restore();
  }
});
