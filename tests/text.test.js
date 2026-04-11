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

  "Test Text Tool Creates Persistent Text"(browser) {
    browser
      .url(serverUrl + "/boards/text-test?lang=en")
      .waitForElementVisible("#toolID-Text")
      .click("#toolID-Text")
      .executeAsync(
        function (done) {
          Tools.curTool.listeners.press(120, 140, {
            target: Tools.board,
            preventDefault: function () {},
          });

          var input = document.getElementById("textToolInput");
          input.value = "Hello text";
          input.dispatchEvent(new Event("keyup"));

          setTimeout(function () {
            input.blur();
            setTimeout(function () {
              var text = document.querySelector("#drawingArea text");
              done({
                text: text && text.textContent,
              });
            }, 150);
          }, 150);
        },
        function (result) {
          browser.assert.equal(result.value.text, "Hello text");
        },
      )
      .pause(1000)
      .refresh()
      .waitForElementVisible("#drawingArea text")
      .execute(
        function () {
          var text = document.querySelector("#drawingArea text");
          return {
            text: text && text.textContent,
          };
        },
        [],
        function (result) {
          browser.assert.equal(result.value.text, "Hello text");
        },
      )
      .end();
  },
};
