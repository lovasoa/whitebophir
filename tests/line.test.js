const { setup, teardown } = require("./lib/test_helper.js");

let serverProcess, serverUrl;

module.exports = {
  async beforeEach(browser, done) {
    ({ child: serverProcess, serverUrl } = await setup(browser));
    done();
  },

  async afterEach(browser, done) {
    await teardown(serverProcess, done, browser);
  },

  "Test Straight Line Snap Persists"(browser) {
    browser
      .url(serverUrl + "/boards/line-test?lang=en")
      .waitForElementVisible("[id='toolID-Straight line']")
      .click("[id='toolID-Straight line']")
      .click("[id='toolID-Straight line']")
      .executeAsync(
        function (done) {
          var evt = {
            preventDefault: function () {},
          };

          Tools.curTool.listeners.press(100, 100, evt);
          Tools.curTool.listeners.move(102, 160, evt);
          Tools.curTool.listeners.release(102, 160, evt);

          setTimeout(function () {
            var line = document.querySelector("#drawingArea line");
            done({
              secondaryActive: Tools.curTool.secondary.active,
              x1: parseFloat(line.getAttribute("x1")),
              y1: parseFloat(line.getAttribute("y1")),
              x2: parseFloat(line.getAttribute("x2")),
              y2: parseFloat(line.getAttribute("y2")),
            });
          }, 150);
        },
        function (result) {
          browser.assert.equal(result.value.secondaryActive, true);
          browser.assert.equal(result.value.x1, 100);
          browser.assert.equal(result.value.y1, 100);
          browser.assert.ok(Math.abs(result.value.x2 - 100) < 0.5);
          browser.assert.ok(Math.abs(result.value.y2 - 160) < 0.5);
        },
      )
      .pause(1000)
      .refresh()
      .waitForElementVisible("#drawingArea line")
      .execute(
        function () {
          var line = document.querySelector("#drawingArea line");
          return {
            x1: parseFloat(line.getAttribute("x1")),
            y1: parseFloat(line.getAttribute("y1")),
            x2: parseFloat(line.getAttribute("x2")),
            y2: parseFloat(line.getAttribute("y2")),
          };
        },
        [],
        function (result) {
          browser.assert.equal(result.value.x1, 100);
          browser.assert.equal(result.value.y1, 100);
          browser.assert.ok(Math.abs(result.value.x2 - 100) < 0.5);
          browser.assert.ok(Math.abs(result.value.y2 - 160) < 0.5);
        },
      )
      .end();
  },
};
