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
    canWrite: true,
  });
});
