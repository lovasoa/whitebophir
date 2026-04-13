const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jsonwebtoken = require("jsonwebtoken");

const { withEnv } = require("./test_helpers.js");

const JWT_BOARDNAME_AUTH_PATH = path.join(
  __dirname,
  "..",
  "server",
  "jwtBoardnameAuth.js",
);

test("roleInBoard allows board-scoped reader access without editor privileges", async function () {
  await withEnv({ AUTH_SECRET_KEY: "test" }, async function () {
    const jwtBoardnameAuth = require(JWT_BOARDNAME_AUTH_PATH);
    const token = jsonwebtoken.sign(
      { sub: "viewer", roles: ["reader:readonly-test"] },
      "test",
    );

    assert.equal(jwtBoardnameAuth.roleInBoard(token, "readonly-test"), "reader");
    assert.equal(jwtBoardnameAuth.roleInBoard(token, "other-board"), "forbidden");
    assert.doesNotThrow(function () {
      jwtBoardnameAuth.checkBoardnameInToken(
        new URL("http://wbo.test/boards/readonly-test?token=" + token),
        "readonly-test",
      );
    });
  });
});
