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

  "Test Square Mode Persists"(browser) {
    browser
      .url(serverUrl + "/boards/rectangle-test?lang=en")
      .waitForElementVisible("#toolID-Rectangle")
      .click("#toolID-Rectangle")
      .click("#toolID-Rectangle")
      .executeAsync(
        function (done) {
          var evt = {
            preventDefault: function () {},
          };

          Tools.curTool.listeners.press(100, 100, evt);
          Tools.curTool.listeners.move(160, 130, evt);
          Tools.curTool.listeners.release(160, 130, evt);

          setTimeout(function () {
            var rect = document.querySelector("#drawingArea rect");
            done({
              secondaryActive: Tools.curTool.secondary.active,
              x: parseFloat(rect.getAttribute("x")),
              y: parseFloat(rect.getAttribute("y")),
              width: parseFloat(rect.getAttribute("width")),
              height: parseFloat(rect.getAttribute("height")),
            });
          }, 150);
        },
        function (result) {
          browser.assert.equal(result.value.secondaryActive, true);
          browser.assert.equal(result.value.x, 100);
          browser.assert.equal(result.value.y, 100);
          browser.assert.equal(result.value.width, 60);
          browser.assert.equal(result.value.height, 60);
        },
      )
      .pause(1000)
      .refresh()
      .waitForElementVisible("#drawingArea rect")
      .execute(
        function () {
          var rect = document.querySelector("#drawingArea rect");
          return {
            x: parseFloat(rect.getAttribute("x")),
            y: parseFloat(rect.getAttribute("y")),
            width: parseFloat(rect.getAttribute("width")),
            height: parseFloat(rect.getAttribute("height")),
          };
        },
        [],
        function (result) {
          browser.assert.equal(result.value.x, 100);
          browser.assert.equal(result.value.y, 100);
          browser.assert.equal(result.value.width, 60);
          browser.assert.equal(result.value.height, 60);
        },
      )
      .end();
  },
};
