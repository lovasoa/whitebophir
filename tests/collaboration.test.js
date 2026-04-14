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
      .waitForElementVisible("#connectedUsersToggle")
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
          .click("#connectedUsersToggle")
          .waitForElementVisible("#connectedUsersPanel")
          .waitForElementVisible("#connectedUsersList .connected-user-row")
          .execute(
            function () {
              var rows = Array.from(
                document.querySelectorAll(
                  "#connectedUsersList .connected-user-row",
                ),
              );
              return rows.map(function (row) {
                var name = row.querySelector(".connected-user-name");
                var meta = row.querySelector(".connected-user-meta");
                var report = row.querySelector(".connected-user-report");
                var dot = row.querySelector(".connected-user-color");
                return {
                  name: name && name.textContent,
                  meta: meta && meta.textContent,
                  isSelf: row.classList.contains("connected-user-row-self"),
                  reportDisabled: !!(report && report.disabled),
                  dotWidth: dot && dot.style.width,
                };
              });
            },
            [],
            function (result) {
              browser.assert.equal(result.value.length, 2);
              browser.assert.equal(
                result.value.filter(function (row) {
                  return row.isSelf;
                }).length,
                1,
              );
              browser.assert.equal(
                result.value.filter(function (row) {
                  return row.reportDisabled;
                }).length,
                1,
              );
            },
          )
          .executeAsync(function (done) {
            Tools.setColor("#ff0000");
            Tools.setSize(11);
            Tools.change("Rectangle");
            Tools.curTool.listeners.press(1100, 800, new Event("mousedown"));
            Tools.curTool.listeners.move(1300, 1000, new Event("mousemove"));
            Tools.curTool.listeners.release(1300, 1000, new Event("mouseup"));
            done();
          })
          .window.switchTo(newWindowHandle)
          .waitForElementVisible("rect[x='1100'][y='800'][stroke='#ff0000']")
          .assert.visible("rect[x='1100'][y='800'][stroke='#ff0000']")
          .click("#connectedUsersToggle")
          .waitForElementVisible("#connectedUsersPanel")
          .pause(150)
          .execute(
            function () {
              var rows = Array.from(
                document.querySelectorAll(
                  "#connectedUsersList .connected-user-row",
                ),
              );
              return rows.map(function (row) {
                return {
                  name:
                    row.querySelector(".connected-user-name") &&
                    row.querySelector(".connected-user-name").textContent,
                  isSelf: row.classList.contains("connected-user-row-self"),
                  meta:
                    row.querySelector(".connected-user-meta") &&
                    row.querySelector(".connected-user-meta").textContent,
                  color:
                    row.querySelector(".connected-user-color") &&
                    row.querySelector(".connected-user-color").style
                      .backgroundColor,
                  dotWidth:
                    row.querySelector(".connected-user-color") &&
                    row.querySelector(".connected-user-color").style.width,
                };
              });
            },
            [],
            function (result) {
              var remoteRow = result.value.find(function (row) {
                return !row.isSelf;
              });
              browser.assert.ok(remoteRow);
              browser.assert.ok(/Rectangle|Pencil/.test(remoteRow.meta || ""));
              browser.assert.ok(parseFloat(remoteRow.dotWidth || "0") > 9);
              browser.assert.ok(
                remoteRow.color === "rgb(255, 0, 0)" ||
                  remoteRow.color === "#ff0000",
              );
            },
          )
          .execute(function () {
            window.scrollTo(0, 0);
          })
          .click("#connectedUsersList .connected-user-row-jumpable")
          .pause(150)
          .execute(
            function () {
              return {
                left: document.documentElement.scrollLeft,
                top: document.documentElement.scrollTop,
              };
            },
            [],
            function (result) {
              browser.assert.ok(result.value.left > 0);
              browser.assert.ok(result.value.top > 0);
            },
          )
          .window.close()
          .window.switchTo(handles[0])
          .pause(150)
          .execute(
            function () {
              return document.querySelectorAll(
                "#connectedUsersList .connected-user-row",
              ).length;
            },
            [],
            function (result) {
              browser.assert.equal(result.value, 1);
            },
          )
          .end();
      });
  },
};
