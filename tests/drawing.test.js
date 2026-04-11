const { setup, teardown } = require("./lib/test_helper.js");

let serverProcess, serverUrl, tokenQuery;

module.exports = {
  async beforeEach(browser, done) {
    ({ child: serverProcess, serverUrl, tokenQuery } = await setup(browser));
    done();
  },

  async afterEach(browser, done) {
    await teardown(serverProcess, done, browser);
  },

  "Test Pencil"(browser) {
    const board = browser.page.board();
    browser.url(serverUrl + "/boards/anonymous?lang=fr&" + tokenQuery);

    board
      .waitForElementVisible("@pencilTool")
      .assert.titleContains("WBO")
      .click("@pencilTool")
      .assert.hasClass("@pencilTool", "curTool")
      .drawPencilPath("#123456", [
        { x: 100, y: 200 },
        { x: 300, y: 400 },
      ])
      .drawPencilPath("#abcdef", [
        { x: 0, y: 0 },
        { x: 90, y: 120 },
        { x: 180, y: 0 },
      ]);

    browser.assert
      .visible(
        "path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']",
      )
      .assert.visible(
        "path[d='M 0 0 L 0 0 C 0 0 40 120 90 120 C 140 120 180 0 180 0'][stroke='#abcdef']",
      )
      .refresh()
      .waitForElementVisible(
        "path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']",
      )
      .assert.visible(
        "path[d='M 0 0 L 0 0 C 0 0 40 120 90 120 C 140 120 180 0 180 0'][stroke='#abcdef']",
      )
      .url(serverUrl + "/preview/anonymous?" + tokenQuery)
      .waitForElementVisible(
        "path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']",
      )
      .assert.visible(
        "path[d='M 0 0 L 0 0 C 0 0 40 120 90 120 C 140 120 180 0 180 0'][stroke='#abcdef']",
      )
      .end();
  },

  "Test Circle"(browser) {
    const board = browser.page.board();
    browser.url(serverUrl + "/boards/anonymous?lang=fr&" + tokenQuery);

    board
      .waitForElementVisible("@pencilTool")
      .click("@ellipseTool")
      .drawCircle("#112233", { x: 200, y: 200 }, 200);

    browser.assert
      .visible(
        "ellipse[cx='200'][cy='200'][rx='200'][ry='200'][stroke='#112233']",
      )
      .refresh()
      .waitForElementVisible(
        "ellipse[cx='200'][cy='200'][rx='200'][ry='200'][stroke='#112233']",
        15000,
      );

    board
      .click("@ellipseTool")
      .click("@ellipseTool")
      .assert.textContains("@ellipseTool", "Cercle");

    browser.end();
  },

  "Test Cursor"(browser) {
    const board = browser.page.board();
    browser.url(serverUrl + "/boards/anonymous?lang=fr&" + tokenQuery);

    board.waitForElementVisible("@pencilTool").moveCursor("#456123", 150, 200);

    board.assert
      .cssProperty("@myCursor", "transform", "matrix(1, 0, 0, 1, 150, 200)")
      .assert.attributeEquals("@myCursor", "fill", "#456123");

    browser.end();
  },
};
