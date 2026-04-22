const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jsonwebtoken = require("jsonwebtoken");
const { createConfig } = require("./test_helpers.js");

const JWT_BOARDNAME_AUTH_PATH = path.join(
  __dirname,
  "..",
  "server",
  "jwtBoardnameAuth.mjs",
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
