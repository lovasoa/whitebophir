const { setup, teardown, writeBoard } = require("./lib/test_helper.js");

let serverProcess, dataPath, serverUrl;

module.exports = {
  async before(browser, done) {
    ({
      child: serverProcess,
      dataPath,
      serverUrl,
    } = await setup(browser, { useJWT: false }));
    done();
  },

  async after(browser, done) {
    await teardown(serverProcess, done, browser);
  },

  "Test ReadOnly Board Without Auth"(browser) {
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

  "Test Menu Hiding"(browser) {
    browser
      .url(serverUrl + "/boards/anonymous?lang=fr&hideMenu=true")
      .waitForElementNotVisible("#menu")
      .url(serverUrl + "/boards/anonymous?lang=fr&hideMenu=false")
      .waitForElementVisible("#menu")
      .end();
  },
};
