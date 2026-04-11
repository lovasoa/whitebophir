const {
  setup,
  teardown,
  TOKENS,
  writeBoard,
  withToken,
  rootUrl,
} = require("./lib/test_helper.js");
const jsonwebtoken = require("jsonwebtoken");
const { AUTH_SECRET } = require("./lib/test_helper.js");

let serverProcess, dataPath, serverUrl, tokenQuery;

module.exports = {
  async beforeEach(browser, done) {
    ({
      child: serverProcess,
      dataPath,
      serverUrl,
      tokenQuery,
    } = await setup(browser));
    done();
  },

  async afterEach(browser, done) {
    await teardown(serverProcess, done);
  },

  "Test ReadOnly Board Without Auth"(browser) {
    if (browser.globals.token) return; // Skip if token is present globally

    const selector =
      "rect[x='10'][y='10'][width='20'][height='20'][stroke='#123456']";

    browser
      .perform(async function (done) {
        await writeBoard(dataPath, "readonly-public", {
          __wbo_meta__: { readonly: true },
        });
        done();
      })
      .url(serverUrl + "/boards/readonly-public")
      .waitForElementVisible("#toolID-Hand")
      .assert.not.elementPresent("#toolID-Pencil")
      .assert.not.elementPresent("#toolID-Line")
      .waitForElementNotVisible("#settings")
      .execute(function () {
        Tools.socket.emit("broadcast", {
          board: Tools.boardName,
          data: {
            type: "rect",
            id: "readonly-public-rect",
            tool: "Rectangle",
            x: 10,
            y: 10,
            x2: 30,
            y2: 30,
            color: "#123456",
            size: 4,
          },
        });
      })
      .refresh()
      .waitForElementVisible("#toolID-Hand")
      .assert.not.elementPresent(selector)
      .end();
  },

  "Test ReadOnly Board With Jwt"(browser) {
    if (!browser.globals.token) return;

    const selector =
      "rect[x='10'][y='10'][width='20'][height='20'][stroke='#123456']";

    browser
      .perform(async function (done) {
        await writeBoard(dataPath, "readonly-test", {
          __wbo_meta__: { readonly: true },
        });
        await writeBoard(dataPath, "readonly-clear", {
          __wbo_meta__: { readonly: true },
          "readonly-clear-rect": {
            type: "rect",
            id: "readonly-clear-rect",
            tool: "Rectangle",
            x: 10,
            y: 10,
            x2: 30,
            y2: 30,
            color: "#ff00ff",
            size: 4,
          },
        });
        done();
      })
      .url(
        withToken(
          serverUrl + "/boards/readonly-test",
          TOKENS.readOnlyViewer,
          tokenQuery,
        ),
      )
      .waitForElementVisible("#toolID-Hand")
      .assert.not.elementPresent("#toolID-Pencil")
      .waitForElementNotVisible("#settings")
      .execute(function () {
        Tools.socket.emit("broadcast", {
          board: Tools.boardName,
          data: {
            type: "rect",
            id: "readonly-viewer-rect",
            tool: "Rectangle",
            x: 10,
            y: 10,
            x2: 30,
            y2: 30,
            color: "#123456",
            size: 4,
          },
        });
      })
      .refresh()
      .waitForElementVisible("#toolID-Hand")
      .assert.not.elementPresent(selector)
      .url(
        withToken(
          serverUrl + "/boards/readonly-test",
          TOKENS.readOnlyGlobalEditor,
          tokenQuery,
        ),
      )
      .waitForElementVisible("#toolID-Pencil")
      .assert.visible("#settings")
      .execute(function () {
        Tools.socket.emit("broadcast", {
          board: Tools.boardName,
          data: {
            type: "rect",
            id: "readonly-editor-rect",
            tool: "Rectangle",
            x: 10,
            y: 10,
            x2: 30,
            y2: 30,
            color: "#123456",
            size: 4,
          },
        });
      })
      .refresh()
      .waitForElementVisible(selector)
      .url(
        withToken(
          serverUrl + "/boards/readonly-test",
          TOKENS.readOnlyBoardEditor,
          tokenQuery,
        ),
      )
      .waitForElementVisible(selector)
      .assert.visible("#toolID-Pencil")
      .url(
        withToken(
          serverUrl + "/boards/readonly-clear",
          TOKENS.readOnlyGlobalModerator,
          tokenQuery,
        ),
      )
      .waitForElementVisible("#toolID-Clear")
      .waitForElementVisible(
        "rect[x='10'][y='10'][width='20'][height='20'][stroke='#ff00ff']",
      )
      .click("#toolID-Clear")
      .refresh()
      .waitForElementVisible("#toolID-Clear")
      .assert.not.elementPresent(
        "rect[x='10'][y='10'][width='20'][height='20'][stroke='#ff00ff']",
      )
      .end();
  },

  "Test Menu Hiding"(browser) {
    browser
      .url(serverUrl + "/boards/anonymous?lang=fr&hideMenu=true&" + tokenQuery)
      .waitForElementNotVisible("#menu")
      .url(serverUrl + "/boards/anonymous?lang=fr&hideMenu=false&" + tokenQuery)
      .waitForElementVisible("#menu")
      .end();
  },

  "Test JWT Authorization"(browser) {
    if (!browser.globals.token) return;

    // global moderator
    browser
      .url(
        withToken(
          serverUrl + "/boards/testboard",
          TOKENS.globalModerator,
          tokenQuery,
        ),
      )
      .waitForElementVisible("#toolID-Clear");

    // other board name
    browser
      .url(
        withToken(
          serverUrl + "/boards/testboard123",
          TOKENS.globalModerator,
          tokenQuery,
        ),
      )
      .waitForElementVisible("#toolID-Clear");

    // board name match
    browser
      .url(
        withToken(
          serverUrl + "/boards/testboard",
          TOKENS.boardModeratorTestboard,
          tokenQuery,
        ),
      )
      .waitForElementVisible("#toolID-Clear");

    // board name mismatch
    browser
      .url(
        withToken(
          serverUrl + "/boards/testboard123",
          TOKENS.boardModeratorTestboard,
          tokenQuery,
        ),
      )
      .waitForElementNotPresent("#menu");

    // global editor
    browser
      .url(
        withToken(
          serverUrl + "/boards/testboard",
          TOKENS.globalEditor,
          tokenQuery,
        ),
      )
      .waitForElementNotPresent("#toolID-Clear")
      .waitForElementVisible("#menu");

    // matching board editor
    browser
      .url(
        withToken(
          serverUrl + "/boards/testboard",
          TOKENS.boardEditorTestboard,
          tokenQuery,
        ),
      )
      .waitForElementVisible("#menu")
      .waitForElementNotPresent("#toolID-Clear");

    // mismatching board editor
    browser
      .url(
        withToken(
          serverUrl + "/boards/testboard123",
          TOKENS.boardEditorTestboard,
          tokenQuery,
        ),
      )
      .waitForElementNotPresent("#menu");

    // moderator with colon in board name
    browser
      .url(
        withToken(
          serverUrl + "/boards/test:board",
          jsonwebtoken.sign(
            { sub: "moderator-colon", roles: ["moderator:test:board"] },
            AUTH_SECRET,
          ),
          tokenQuery,
        ),
      )
      .waitForElementNotPresent("#menu");

    browser.end();
  },
};
