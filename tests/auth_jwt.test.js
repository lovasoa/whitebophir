const { setup, teardown, TOKENS, writeBoard, withToken, AUTH_SECRET } = require("./lib/test_helper.js");
const jsonwebtoken = require("jsonwebtoken");

let serverProcess, dataPath, serverUrl, tokenQuery;

module.exports = {
  async beforeEach(browser, done) {
    ({ child: serverProcess, dataPath, serverUrl, tokenQuery } = await setup(browser, { useJWT: true }));
    done();
  },

  async afterEach(browser, done) {
    await teardown(serverProcess, done);
  },

  "Test ReadOnly Board With Jwt"(browser) {
    const selector = "rect[x='10'][y='10'][width='20'][height='20'][stroke='#123456']";

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
      .url(withToken(serverUrl + "/boards/readonly-test", TOKENS.readOnlyViewer, tokenQuery))
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
      .url(withToken(serverUrl + "/boards/readonly-test", TOKENS.readOnlyGlobalEditor, tokenQuery))
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
      .url(withToken(serverUrl + "/boards/readonly-test", TOKENS.readOnlyBoardEditor, tokenQuery))
      .waitForElementVisible(selector)
      .assert.visible("#toolID-Pencil")
      .url(withToken(serverUrl + "/boards/readonly-clear", TOKENS.readOnlyGlobalModerator, tokenQuery))
      .waitForElementVisible("#toolID-Clear")
      .waitForElementVisible("rect[x='10'][y='10'][width='20'][height='20'][stroke='#ff00ff']")
      .click("#toolID-Clear")
      .refresh()
      .waitForElementVisible("#toolID-Clear")
      .assert.not.elementPresent("rect[x='10'][y='10'][width='20'][height='20'][stroke='#ff00ff']")
      .end();
  },

  "Test JWT Authorization"(browser) {
    // global moderator
    browser
      .url(withToken(serverUrl + "/boards/testboard", TOKENS.globalModerator, tokenQuery))
      .waitForElementVisible("#toolID-Clear");

    // other board name
    browser
      .url(withToken(serverUrl + "/boards/testboard123", TOKENS.globalModerator, tokenQuery))
      .waitForElementVisible("#toolID-Clear");

    // board name match
    browser
      .url(withToken(serverUrl + "/boards/testboard", TOKENS.boardModeratorTestboard, tokenQuery))
      .waitForElementVisible("#toolID-Clear");

    // board name mismatch
    browser
      .url(withToken(serverUrl + "/boards/testboard123", TOKENS.boardModeratorTestboard, tokenQuery))
      .waitForElementNotPresent("#menu")

    // global editor
    browser
      .url(withToken(serverUrl + "/boards/testboard", TOKENS.globalEditor, tokenQuery))
      .waitForElementNotPresent("#toolID-Clear")
      .waitForElementVisible("#menu");

    // matching board editor
    browser
      .url(withToken(serverUrl + "/boards/testboard", TOKENS.boardEditorTestboard, tokenQuery))
      .waitForElementVisible("#menu")
      .waitForElementNotPresent("#toolID-Clear");

    // mismatching board editor
    browser
      .url(withToken(serverUrl + "/boards/testboard123", TOKENS.boardEditorTestboard, tokenQuery))
      .waitForElementNotPresent("#menu")

    // moderator with colon in board name
    browser
      .url(
        withToken(
          serverUrl + "/boards/test:board",
          jsonwebtoken.sign({ sub: "moderator-colon", roles: ["moderator:test:board"] }, AUTH_SECRET),
          tokenQuery,
        ),
      )
      .waitForElementNotPresent("#menu")

    browser.end();
  },
};
