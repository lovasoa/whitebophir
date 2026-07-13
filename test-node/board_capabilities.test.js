const test = require("node:test");
const assert = require("node:assert/strict");
const jsonwebtoken = require("jsonwebtoken");

const { BOARD_CAPABILITIES_PATH, createConfig } = require("./test_helpers.js");

/**
 * @param {string} name
 * @param {boolean} readonly
 * @returns {{name: string, isReadOnly: () => boolean}}
 */
function createBoard(name, readonly) {
  return {
    name,
    isReadOnly: () => readonly,
  };
}

/**
 * @param {{AUTH_SECRET_KEY: string}} config
 * @param {{[key: string]: unknown}} payload
 * @returns {string}
 */
function tokenFor(config, payload) {
  return jsonwebtoken.sign(payload, config.AUTH_SECRET_KEY);
}

test("board capabilities preserve JWT-disabled writable board behavior", () => {
  const { BoardPermissions } = require(BOARD_CAPABILITIES_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "" });
  const board = createBoard("open-board", false);

  assert.deepEqual(
    BoardPermissions.resolveCapabilities({ config, board, userInfo: {} }),
    {
      canOpen: true,
      canEdit: true,
      canClear: false,
    },
  );
});

test("board capabilities preserve JWT-disabled read-only board behavior", () => {
  const { BoardPermissions } = require(BOARD_CAPABILITIES_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "" });
  const board = createBoard("readonly-board", true);

  assert.deepEqual(
    BoardPermissions.resolveCapabilities({ config, board, userInfo: {} }),
    {
      canOpen: true,
      canEdit: false,
      canClear: false,
    },
  );
});

test("board capabilities reject JWT board claims that do not match the requested board", () => {
  const { BoardPermissions } = require(BOARD_CAPABILITIES_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "test-secret" });
  const token = tokenFor(config, { roles: ["reader:allowed-board"] });
  const board = createBoard("blocked-board", false);

  assert.deepEqual(
    BoardPermissions.resolveCapabilities({
      config,
      board,
      userInfo: { token },
    }),
    {
      canOpen: false,
      canEdit: false,
      canClear: false,
    },
  );
});

test("board capabilities allow edit-capable JWT claims to edit read-only boards", () => {
  const { BoardPermissions } = require(BOARD_CAPABILITIES_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "test-secret" });
  const token = tokenFor(config, { roles: ["editor:readonly-board"] });
  const board = createBoard("readonly-board", true);

  assert.deepEqual(
    BoardPermissions.resolveCapabilities({
      config,
      board,
      userInfo: { token },
    }),
    {
      canOpen: true,
      canEdit: true,
      canClear: false,
    },
  );
});

test("board capabilities allow clear-capable JWT claims to clear boards", () => {
  const { BoardPermissions } = require(BOARD_CAPABILITIES_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "test-secret" });
  const token = tokenFor(config, { roles: ["moderator:clear-board"] });
  const board = createBoard("clear-board", false);
  const permissions = BoardPermissions.forBoard({
    config,
    boardName: board.name,
    userInfo: { token },
  });

  assert.equal(permissions.canOpen(), true);
  assert.deepEqual(permissions.boardState(board), {
    readonly: false,
    canEdit: true,
    canClear: true,
    canReport: true,
    canWrite: true,
  });
});

test("a live edit ban degrades a non-moderator to read-only", () => {
  const { BoardPermissions } = require(BOARD_CAPABILITIES_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "" });
  const board = createBoard("open-board", false);
  const permissions = BoardPermissions.forBoard({
    config,
    boardName: board.name,
    userInfo: {},
    isBanned: () => true,
  });

  assert.equal(permissions.canOpen(), true); // still allowed to view
  assert.deepEqual(permissions.resolveCapabilities(board), {
    canOpen: true,
    canEdit: false,
    canClear: false,
  });
  assert.equal(permissions.canReport(), false);
});

test("a moderator bypasses edit bans", () => {
  const { BoardPermissions } = require(BOARD_CAPABILITIES_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "test-secret" });
  const token = tokenFor(config, { roles: ["moderator:clear-board"] });
  const board = createBoard("clear-board", false);
  const permissions = BoardPermissions.forBoard({
    config,
    boardName: board.name,
    userInfo: { token },
    isBanned: () => true,
  });

  assert.deepEqual(permissions.resolveCapabilities(board), {
    canOpen: true,
    canEdit: true,
    canClear: true,
  });
  assert.equal(permissions.canReport(), true);
});

test("ban state is re-read live on each capability query", () => {
  const { BoardPermissions } = require(BOARD_CAPABILITIES_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "" });
  const board = createBoard("open-board", false);
  let banned = false;
  const permissions = BoardPermissions.forBoard({
    config,
    boardName: board.name,
    userInfo: {},
    isBanned: () => banned,
  });

  assert.equal(permissions.resolveCapabilities(board).canEdit, true);
  banned = true;
  assert.equal(permissions.resolveCapabilities(board).canEdit, false);
  banned = false; // e.g. the ban TTL expired
  assert.equal(permissions.resolveCapabilities(board).canEdit, true);
});

test("expiry-aware board state carries one access refresh delay", () => {
  const { BoardPermissions } = require(BOARD_CAPABILITIES_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "" });
  const board = createBoard("open-board", false);
  let expiresAt = Date.now() + 60_000;
  const permissions = BoardPermissions.forBoard({
    config,
    boardName: board.name,
    userInfo: {},
    getBanExpiresAt: () => expiresAt,
  });

  const bannedState = permissions.boardState(board);
  assert.equal(bannedState.canEdit, false);
  assert.equal(bannedState.canReport, false);
  assert.ok(
    typeof bannedState.accessRefreshAfterMs === "number" &&
      bannedState.accessRefreshAfterMs > 59_000 &&
      bannedState.accessRefreshAfterMs <= 60_000,
  );

  expiresAt = 0;
  assert.deepEqual(permissions.boardState(board), {
    readonly: false,
    canEdit: true,
    canClear: false,
    canReport: true,
    canWrite: true,
  });
});
