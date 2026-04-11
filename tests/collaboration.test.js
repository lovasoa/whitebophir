const {
  setup,
  teardown,
  seedSocketHeaders,
  DEFAULT_FORWARDED_IP,
  rootUrl,
} = require("./lib/test_helper.js");

let serverProcess, serverUrl, tokenQuery;

module.exports = {
  async before(browser, done) {
    ({ child: serverProcess, serverUrl, tokenQuery } = await setup(browser));
    done();
  },

  async after(browser, done) {
    await teardown(serverProcess, done, browser);
  },

  "Test Collaborativeness"(browser) {
    const boardUrl =
      serverUrl + "/boards/collaborative-test?lang=en&" + tokenQuery;

    seedSocketHeaders(
      browser,
      serverUrl,
      DEFAULT_FORWARDED_IP,
      null,
      tokenQuery,
    )
      .url(boardUrl)
      .waitForElementVisible(".tool[title ~= Pencil]")
      .click(".tool[title ~= Pencil]")
      .assert.hasClass(".tool[title ~= Pencil]", "curTool")
      .window.open()
      .window.getAllHandles(function (result) {
        const handles = result.value;
        const newWindowHandle = handles[handles.length - 1];

        browser.window
          .switchTo(newWindowHandle)
          .url(rootUrl(serverUrl, null, tokenQuery))
          .execute(
            function (socketHeaders) {
              window.socketio_extra_headers = socketHeaders;
              sessionStorage.setItem(
                "socketio_extra_headers",
                JSON.stringify(socketHeaders),
              );
            },
            [{ "X-Forwarded-For": DEFAULT_FORWARDED_IP }],
          )
          .url(boardUrl)
          .window.switchTo(handles[0])
          .executeAsync(function (done) {
            Tools.setColor("#ff0000");
            Tools.curTool.listeners.press(100, 100, new Event("mousedown"));
            Tools.curTool.listeners.move(200, 200, new Event("mousemove"));
            Tools.curTool.listeners.release(200, 200, new Event("mouseup"));
            done();
          })
          .window.switchTo(newWindowHandle)
          .waitForElementVisible("path[d^='M 100 100'][stroke='#ff0000']")
          .assert.visible("path[d^='M 100 100'][stroke='#ff0000']")
          .window.close()
          .window.switchTo(handles[0])
          .end();
      });
  },
};
