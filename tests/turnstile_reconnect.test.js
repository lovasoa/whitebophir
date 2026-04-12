const http = require("node:http");
const assert = require("node:assert/strict");
const { setup, teardown } = require("./lib/test_helper.js");

let serverProcess, serverUrl, turnstileVerifyServer;

function startTurnstileVerifyServer() {
  return new Promise((resolve) => {
    const server = http.createServer(function onRequest(req, res) {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success:
              params.get("secret") === "test-secret" &&
              !!params.get("response"),
            hostname: "localhost",
          }),
        );
      });
    });

    server.listen(0, "127.0.0.1", function onListen() {
      resolve(server);
    });
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

module.exports = {
  async before(browser, done) {
    turnstileVerifyServer = await startTurnstileVerifyServer();
    const verifyPort = turnstileVerifyServer.address().port;
    ({ child: serverProcess, serverUrl } = await setup(browser, {
      env: {
        TURNSTILE_SECRET_KEY: "test-secret",
        TURNSTILE_SITE_KEY: "test-site-key",
        TURNSTILE_VERIFY_URL: "http://127.0.0.1:" + verifyPort + "/siteverify",
      },
    }));
    done();
  },

  async after(browser, done) {
    try {
      await closeServer(turnstileVerifyServer);
    } finally {
      await teardown(serverProcess, done, browser);
    }
  },

  "Reconnect resets Turnstile and recovers protected writes"(browser) {
    const board = browser.page.board();
    const boardUrl = serverUrl + "/boards/anonymous?lang=fr";

    browser
      .url(boardUrl)
      .waitForElementVisible(".tool[title ~= Crayon]")
      .execute(function () {
        window.__receivedBroadcasts = [];
        Tools.socket.on("broadcast", function (message) {
          window.__receivedBroadcasts.push(message);
        });
        window.turnstile = {
          render: function (_, options) {
            window.__turnstileOptions = options;
            return "test-turnstile-widget";
          },
          remove: function () {},
          reset: function () {},
        };
      })
      .executeAsync(
        function (done) {
          Tools.socket.emit(
            "turnstile_token",
            "validated-before-reconnect",
            function (result) {
              var turnstileResult = Tools.normalizeTurnstileAck(result);
              if (turnstileResult.success)
                Tools.setTurnstileValidation(turnstileResult);
              done({
                success: turnstileResult.success,
                validated: Tools.isTurnstileValidated(),
              });
            },
          );
        },
        function (result) {
          assert.equal(result.value.success, true);
          assert.equal(result.value.validated, true);
        },
      )
      .window.open()
      .window.getAllHandles(function (result) {
        const firstHandle = result.value[0];
        const secondHandle = result.value[result.value.length - 1];

        browser.window
          .switchTo(secondHandle)
          .url(boardUrl)
          .waitForElementVisible(".tool[title ~= Crayon]")
          .execute(function () {
            window.__receivedBroadcasts = [];
            Tools.socket.on("broadcast", function (message) {
              window.__receivedBroadcasts.push(message);
            });
          })
          .window.switchTo(firstHandle)
          .executeAsync(
            function (done) {
              var timeout = setTimeout(function () {
                done({
                  timedOut: true,
                  connected: Tools.socket.connected,
                  validated: Tools.isTurnstileValidated(),
                });
              }, 5000);

              Tools.socket.once("reconnect", function () {
                clearTimeout(timeout);
                setTimeout(function () {
                  done({
                    timedOut: false,
                    connected: Tools.socket.connected,
                    validated: Tools.isTurnstileValidated(),
                  });
                }, 100);
              });

              Tools.socket.io.engine.close();
            },
            function (reconnectResult) {
              assert.equal(reconnectResult.value.timedOut, false);
              assert.equal(reconnectResult.value.connected, true);
              assert.equal(reconnectResult.value.validated, false);
            },
          )
          .window.switchTo(secondHandle)
          .execute(function () {
            Tools.socket.emit("broadcast", {
              board: Tools.boardName,
              data: {
                tool: "Cursor",
                type: "update",
                x: 210,
                y: 220,
                color: "#00aa11",
                size: 6,
              },
            });
          })
          .window.switchTo(firstHandle)
          .executeAsync(
            function (color, done) {
              var deadline = Date.now() + 5000;
              (function check() {
                var received = (window.__receivedBroadcasts || []).some(
                  function (message) {
                    return message && message.color === color;
                  },
                );
                if (received) {
                  done({ received: true });
                  return;
                }
                if (Date.now() >= deadline) {
                  done({
                    received: false,
                    messages: window.__receivedBroadcasts || [],
                  });
                  return;
                }
                setTimeout(check, 50);
              })();
            },
            ["#00aa11"],
            function (broadcastResult) {
              assert.equal(
                broadcastResult.value.received,
                true,
                JSON.stringify(broadcastResult.value.messages),
              );
            },
          )
          .execute(function () {
            Tools.socket.emit("broadcast", {
              board: Tools.boardName,
              data: {
                tool: "Cursor",
                type: "update",
                x: 260,
                y: 280,
                color: "#123abc",
                size: 8,
              },
            });
          })
          .window.switchTo(secondHandle)
          .executeAsync(
            function (color, done) {
              var deadline = Date.now() + 5000;
              (function check() {
                var received = (window.__receivedBroadcasts || []).some(
                  function (message) {
                    return message && message.color === color;
                  },
                );
                if (received) {
                  done({ received: true });
                  return;
                }
                if (Date.now() >= deadline) {
                  done({
                    received: false,
                    messages: window.__receivedBroadcasts || [],
                  });
                  return;
                }
                setTimeout(check, 50);
              })();
            },
            ["#123abc"],
            function (broadcastResult) {
              assert.equal(
                broadcastResult.value.received,
                true,
                JSON.stringify(broadcastResult.value.messages),
              );
            },
          )
          .window.switchTo(firstHandle)
          .executeAsync(
            function (done) {
              Tools.drawAndSend(
                {
                  type: "rect",
                  id: "reconnect-turnstile-rect",
                  x: 10,
                  y: 20,
                  x2: 40,
                  y2: 50,
                  color: "#112233",
                  size: 4,
                  opacity: 1,
                },
                Tools.list.Rectangle,
              );

              // Simulate Cloudflare triggering the interactive challenge
              if (
                window.__turnstileOptions &&
                window.__turnstileOptions["before-interactive-callback"]
              ) {
                window.__turnstileOptions["before-interactive-callback"]();
              }

              setTimeout(function () {
                done({
                  overlayPresent:
                    !!document.getElementById("turnstile-overlay") &&
                    !document
                      .getElementById("turnstile-overlay")
                      .classList.contains("turnstile-overlay-hidden"),
                  pendingWrites: Tools.turnstilePendingWrites.length,
                  validated: Tools.isTurnstileValidated(),
                });
              }, 550);
            },
            [],
            function (pendingResult) {
              assert.equal(pendingResult.value.overlayPresent, true);
              assert.equal(pendingResult.value.pendingWrites, 1);
              assert.equal(pendingResult.value.validated, false);
            },
          )
          .executeAsync(
            function (done) {
              window.__turnstileOptions.callback("reconnect-recovery-token");
              setTimeout(function () {
                done({
                  overlayPresent:
                    !!document.getElementById("turnstile-overlay") &&
                    !document
                      .getElementById("turnstile-overlay")
                      .classList.contains("turnstile-overlay-hidden"),
                  pendingWrites: Tools.turnstilePendingWrites.length,
                  validated: Tools.isTurnstileValidated(),
                });
              }, 250);
            },
            function (recoveryResult) {
              assert.equal(recoveryResult.value.overlayPresent, false);
              assert.equal(recoveryResult.value.pendingWrites, 0);
              assert.equal(recoveryResult.value.validated, true);
            },
          );

        board
          .waitForElementVisible("rect#reconnect-turnstile-rect")
          .waitForSavedBoard("anonymous", function (storedBoard) {
            return storedBoard["reconnect-turnstile-rect"] != null;
          });

        browser.window
          .switchTo(secondHandle)
          .waitForElementVisible("rect#reconnect-turnstile-rect")
          .window.close()
          .window.switchTo(firstHandle)
          .end();
      });
  },
};
