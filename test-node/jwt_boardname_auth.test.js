const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jsonwebtoken = require("jsonwebtoken");
const { createConfig } = require("./test_helpers.js");

const JWT_BOARDNAME_AUTH_PATH = path.join(
  __dirname,
  "..",
  "server",
  "auth",
  "board_jwt.mjs",
);

test("roleInBoard allows board-scoped reader access without editor privileges", async () => {
  const jwtBoardnameAuth = require(JWT_BOARDNAME_AUTH_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "test" });
  const token = jsonwebtoken.sign(
    { sub: "viewer", roles: ["reader:readonly-test"] },
    "test",
  );

  assert.equal(
    jwtBoardnameAuth.roleInBoard(config, token, "readonly-test"),
    "reader",
  );
  assert.equal(
    jwtBoardnameAuth.roleInBoard(config, token, "other-board"),
    "forbidden",
  );
  assert.doesNotThrow(() => {
    jwtBoardnameAuth.checkBoardnameInToken(
      config,
      new URL(`http://wbo.test/boards/readonly-test?token=${token}`),
      "readonly-test",
    );
  });
});

test("malformed JWT role claims are denied without throwing during resolution", () => {
  const { roleInBoard, checkBoardnameInToken } = require(
    JWT_BOARDNAME_AUTH_PATH,
  );
  const config = createConfig({ AUTH_SECRET_KEY: "test" });
  const malformedRoles = [
    null,
    false,
    0,
    "",
    "moderator:team",
    {},
    { role: "editor:team" },
    [null],
    [42],
    ["editor:team", {}],
  ];

  for (const roles of malformedRoles) {
    const token = jsonwebtoken.sign({ roles }, config.AUTH_SECRET_KEY);
    assert.equal(roleInBoard(config, token, "team"), "forbidden");
    assert.equal(roleInBoard(config, token, null), "forbidden");
    assert.throws(
      () =>
        checkBoardnameInToken(
          config,
          new URL(`http://wbo.test/boards/team?token=${token}`),
          "team",
        ),
      { message: "access_forbidden" },
    );
  }
});

test("JWTs with absent or empty roles retain default editor access", () => {
  const { roleInBoard } = require(JWT_BOARDNAME_AUTH_PATH);
  const config = createConfig({ AUTH_SECRET_KEY: "test" });
  for (const payload of [{ sub: "editor" }, { roles: [] }]) {
    const token = jsonwebtoken.sign(payload, config.AUTH_SECRET_KEY);
    assert.equal(roleInBoard(config, token, "team"), "editor");
  }
});
