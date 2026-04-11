const { setup, teardown, seedSocketHeaders } = require("./lib/test_helper.js");

let serverProcess, serverUrl, tokenQuery;

const RATE_LIMIT_TEST_IP = "198.51.100.200";

module.exports = {
  async before(browser, done) {
    ({ child: serverProcess, serverUrl, tokenQuery } = await setup(browser));
    done();
  },

  async after(browser, done) {
    await teardown(serverProcess, done, browser);
  },

  "Test Rate Limit Alert"(browser) {
    const boardUrl =
      serverUrl + "/boards/rate-limit-test?lang=en&" + tokenQuery;
    const rateLimitHeaders = {
      "X-Forwarded-For": RATE_LIMIT_TEST_IP,
    };

    seedSocketHeaders(browser, serverUrl, rateLimitHeaders, null, tokenQuery)
      .url(boardUrl)
      .waitForElementVisible("#toolID-Eraser")
      .execute(function () {
        window.__lastAlert = null;
        window.alert = function (message) {
          window.__lastAlert = message;
        };
      })
      .executeAsync(
        function (done) {
          for (var i = 0; i < 101; i++) {
            Tools.socket.emit("broadcast", {
              board: Tools.boardName,
              data: {
                tool: "Eraser",
                type: "delete",
                id: "rate-limit-" + i,
              },
            });
          }

          setTimeout(function () {
            done({
              alert: window.__lastAlert,
              connected: Tools.socket.connected,
            });
          }, 1000);
        },
        function (result) {
          browser.assert.equal(
            result.value.alert,
            "You're sending changes too quickly, so we paused your connection to protect the board. Please wait a minute and try again.",
          );
          browser.assert.equal(result.value.connected, false);
        },
      )
      .end();
  },
};
