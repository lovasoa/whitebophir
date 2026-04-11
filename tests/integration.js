const fsp = require("node:fs/promises");
const jsonwebtoken = require("jsonwebtoken");
const os = require("node:os");
const path = require("node:path");

const PORT = 8487;
const SERVER = "http://localhost:" + PORT;
const AUTH_SECRET = "test";
const DEFAULT_FORWARDED_IP = "198.51.100.10";
const RATE_LIMIT_TEST_IP = "198.51.100.200";
const DEFAULT_SOCKETIO_EXTRA_HEADERS = {
  "X-Forwarded-For": DEFAULT_FORWARDED_IP,
};

const TOKENS = {
  globalModerator: jsonwebtoken.sign(
    { sub: "moderator", roles: ["moderator"] },
    AUTH_SECRET,
  ),
  boardModeratorTestboard: jsonwebtoken.sign(
    { sub: "moderator-board", roles: ["moderator:testboard"] },
    AUTH_SECRET,
  ),
  globalEditor: jsonwebtoken.sign(
    { sub: "editor", roles: ["editor"] },
    AUTH_SECRET,
  ),
  boardEditorTestboard: jsonwebtoken.sign(
    { sub: "editor-board", roles: ["editor:testboard"] },
    AUTH_SECRET,
  ),
  readOnlyViewer: jsonwebtoken.sign(
    { sub: "viewer", roles: ["reader:readonly-test"] },
    AUTH_SECRET,
  ),
  readOnlyGlobalEditor: jsonwebtoken.sign(
    { sub: "readonly-editor", roles: ["editor"] },
    AUTH_SECRET,
  ),
  readOnlyBoardEditor: jsonwebtoken.sign(
    { sub: "readonly-board-editor", roles: ["editor:readonly-test"] },
    AUTH_SECRET,
  ),
  readOnlyGlobalModerator: jsonwebtoken.sign(
    { sub: "readonly-moderator", roles: ["moderator"] },
    AUTH_SECRET,
  ),
};

let wbo, data_path, tokenQuery;

function withToken(url, token) {
  const query = token ? "token=" + token : tokenQuery;
  if (!query) return url;
  return url + (url.includes("?") ? "&" : "?") + query;
}

function boardFile(name) {
  return path.join(data_path, "board-" + encodeURIComponent(name) + ".json");
}

async function writeBoard(name, storedBoard) {
  await fsp.writeFile(boardFile(name), JSON.stringify(storedBoard));
}

function rootUrl(token) {
  return withToken(SERVER + "/", token);
}

function seedSocketHeaders(browser, headers, token) {
  return browser.url(rootUrl(token)).execute(
    function (socketHeaders) {
      window.socketio_extra_headers = socketHeaders;
      sessionStorage.setItem(
        "socketio_extra_headers",
        JSON.stringify(socketHeaders),
      );
    },
    [headers],
  );
}

async function beforeEach(browser, done) {
  data_path = await fsp.mkdtemp(path.join(os.tmpdir(), "wbo-test-data-"));
  process.env["PORT"] = PORT;
  process.env["WBO_HISTORY_DIR"] = data_path;
  process.env["WBO_MAX_EMIT_COUNT"] = "1000";
  process.env["WBO_MAX_EMIT_COUNT_PERIOD"] = "4096";
  process.env["WBO_IP_SOURCE"] = "X-Forwarded-For";
  tokenQuery = "";
  if (browser.globals.token) {
    process.env["AUTH_SECRET_KEY"] = AUTH_SECRET;
    tokenQuery = "token=" + browser.globals.token;
  } else {
    delete process.env["AUTH_SECRET_KEY"];
  }
  console.log("Launching WBO in " + data_path);
  wbo = require("../server/server.js");
  done();
}

async function afterEach(browser, done) {
  wbo.close();
  done();
}

function testRateLimitAlert(browser) {
  const boardUrl = SERVER + "/boards/rate-limit-test?lang=en&" + tokenQuery;
  const rateLimitHeaders = {
    "X-Forwarded-For": RATE_LIMIT_TEST_IP,
  };

  return seedSocketHeaders(browser, rateLimitHeaders)
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
    );
}

function testPencil(browser) {
  return browser.assert
    .titleContains("WBO")
    .click(".tool[title ~= Crayon]") // pencil
    .assert.hasClass(".tool[title ~= Crayon]", "curTool")
    .executeAsync(async function (done) {
      function sleep(t) {
        return new Promise(function (accept) {
          setTimeout(accept, t);
        });
      }
      // A straight path with just two points
      Tools.setColor("#123456");
      Tools.curTool.listeners.press(100, 200, new Event("mousedown"));
      await sleep(80);
      Tools.curTool.listeners.release(300, 400, new Event("mouseup"));

      // A line with three points that form an "U" shape
      await sleep(80);
      Tools.setColor("#abcdef");
      Tools.curTool.listeners.press(0, 0, new Event("mousedown"));
      await sleep(80);
      Tools.curTool.listeners.move(90, 120, new Event("mousemove"));
      await sleep(80);
      Tools.curTool.listeners.release(180, 0, new Event("mouseup"));
      done();
    })
    .assert.visible(
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
    .url(SERVER + "/preview/anonymous?" + tokenQuery)
    .waitForElementVisible(
      "path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']",
    )
    .assert.visible(
      "path[d='M 0 0 L 0 0 C 0 0 40 120 90 120 C 140 120 180 0 180 0'][stroke='#abcdef']",
    )
    .back();
}

function testCircle(browser) {
  return browser
    .click("#toolID-Ellipse")
    .executeAsync(function (done) {
      Tools.setColor("#112233");
      Tools.curTool.listeners.press(400, 400, new Event("mousedown"));
      setTimeout(() => {
        const evt = new Event("mousemove");
        evt.shiftKey = true;
        Tools.curTool.listeners.move(0, 0, evt);
        Tools.curTool.listeners.release(0, 0, new Event("mouseup"));
        done();
      }, 100);
    })
    .assert.visible(
      "ellipse[cx='200'][cy='200'][rx='200'][ry='200'][stroke='#112233']",
    )
    .refresh()
    .waitForElementVisible(
      "ellipse[cx='200'][cy='200'][rx='200'][ry='200'][stroke='#112233']",
      15000,
    )
    .click("#toolID-Ellipse") // Click the ellipse tool
    .click("#toolID-Ellipse") // Click again to toggle
    .assert.textContains("#toolID-Ellipse .tool-name", "Cercle"); // Circle in french
}

function testCursor(browser) {
  return browser
    .execute(function (done) {
      Tools.setColor("#456123"); // Move the cursor over the board
      var e = new Event("mousemove");
      e.pageX = 150;
      e.pageY = 200;
      Tools.board.dispatchEvent(e);
    })
    .assert.cssProperty(
      "#cursor-me",
      "transform",
      "matrix(1, 0, 0, 1, 150, 200)",
    )
    .assert.attributeEquals("#cursor-me", "fill", "#456123");
}

function testCollaborativeness(browser) {
  const boardUrl = SERVER + "/boards/collaborative-test?lang=en&" + tokenQuery;

  return seedSocketHeaders(browser, DEFAULT_SOCKETIO_EXTRA_HEADERS)
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
        .url(rootUrl())
        .execute(
          function (socketHeaders) {
            window.socketio_extra_headers = socketHeaders;
            sessionStorage.setItem(
              "socketio_extra_headers",
              JSON.stringify(socketHeaders),
            );
          },
          [DEFAULT_SOCKETIO_EXTRA_HEADERS],
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
        .window.switchTo(handles[0]);
    });
}

function testReadOnlyBoardWithoutAuth(browser) {
  const selector =
    "rect[x='10'][y='10'][width='20'][height='20'][stroke='#123456']";

  return browser
    .perform(async function (done) {
      await writeBoard("readonly-public", {
        __wbo_meta__: { readonly: true },
      });
      done();
    })
    .url(SERVER + "/boards/readonly-public")
    .waitForElementVisible("#toolID-Hand")
    .assert.elementNotPresent("#toolID-Pencil")
    .assert.elementNotPresent("#toolID-Line")
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
    .assert.elementNotPresent(selector);
}

function testReadOnlyBoardWithJwt(browser) {
  const selector =
    "rect[x='10'][y='10'][width='20'][height='20'][stroke='#123456']";

  return browser
    .perform(async function (done) {
      await writeBoard("readonly-test", {
        __wbo_meta__: { readonly: true },
      });
      await writeBoard("readonly-clear", {
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
    .url(withToken(SERVER + "/boards/readonly-test", TOKENS.readOnlyViewer))
    .waitForElementVisible("#toolID-Hand")
    .assert.elementNotPresent("#toolID-Pencil")
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
    .assert.elementNotPresent(selector)
    .url(
      withToken(SERVER + "/boards/readonly-test", TOKENS.readOnlyGlobalEditor),
    )
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
    .url(
      withToken(SERVER + "/boards/readonly-test", TOKENS.readOnlyBoardEditor),
    )
    .waitForElementVisible(selector)
    .assert.visible("#toolID-Pencil")
    .url(
      withToken(
        SERVER + "/boards/readonly-clear",
        TOKENS.readOnlyGlobalModerator,
      ),
    )
    .waitForElementVisible("#toolID-Clear")
    .waitForElementVisible(
      "rect[x='10'][y='10'][width='20'][height='20'][stroke='#ff00ff']",
    )
    .click("#toolID-Clear")
    .refresh()
    .waitForElementVisible("#toolID-Clear")
    .assert.elementNotPresent(
      "rect[x='10'][y='10'][width='20'][height='20'][stroke='#ff00ff']",
    );
}

function testBoard(browser) {
  var page = seedSocketHeaders(browser, DEFAULT_SOCKETIO_EXTRA_HEADERS)
    .url(SERVER + "/boards/anonymous?lang=fr&" + tokenQuery)
    .waitForElementVisible(".tool[title ~= Crayon]");
  page = testPencil(page);
  page = testCircle(page);
  page = testCursor(page);
  page = testCollaborativeness(page);

  // test hideMenu
  browser
    .url(SERVER + "/boards/anonymous?lang=fr&hideMenu=true&" + tokenQuery)
    .waitForElementNotVisible("#menu");
  browser
    .url(SERVER + "/boards/anonymous?lang=fr&hideMenu=false&" + tokenQuery)
    .waitForElementVisible("#menu");
  if (!browser.globals.token) {
    testReadOnlyBoardWithoutAuth(browser);
  }
  if (browser.globals.token) {
    //has moderator jwt and no board name
    browser
      .url(withToken(SERVER + "/boards/testboard", TOKENS.globalModerator))
      .waitForElementVisible("#toolID-Clear");
    //has moderator JWT and other board name
    browser
      .url(withToken(SERVER + "/boards/testboard123", TOKENS.globalModerator))
      .waitForElementVisible("#toolID-Clear");
    //has moderator JWT and board name match board name in url
    browser
      .url(
        withToken(SERVER + "/boards/testboard", TOKENS.boardModeratorTestboard),
      )
      .waitForElementVisible("#toolID-Clear");
    //has moderator JWT and board name NOT match board name in url
    browser
      .url(
        withToken(
          SERVER + "/boards/testboard123",
          TOKENS.boardModeratorTestboard,
        ),
      )
      .waitForElementNotPresent("#menu");
    //has editor JWT and no boardname provided
    browser
      .url(withToken(SERVER + "/boards/testboard", TOKENS.globalEditor))
      .waitForElementNotPresent("#toolID-Clear");
    browser
      .url(withToken(SERVER + "/boards/testboard", TOKENS.globalEditor))
      .waitForElementVisible("#menu");
    //has editor JWT and  boardname provided and match to the board in the url
    browser
      .url(withToken(SERVER + "/boards/testboard", TOKENS.boardEditorTestboard))
      .waitForElementVisible("#menu");
    browser
      .url(withToken(SERVER + "/boards/testboard", TOKENS.boardEditorTestboard))
      .waitForElementNotPresent("#toolID-Clear");
    //has editor JWT and  boardname provided and and not match to the board in the url
    browser
      .url(
        withToken(SERVER + "/boards/testboard123", TOKENS.boardEditorTestboard),
      )
      .waitForElementNotPresent("#menu");
    //is moderator and boardname contains ":"
    browser
      .url(
        withToken(
          SERVER + "/boards/test:board",
          jsonwebtoken.sign(
            { sub: "moderator-colon", roles: ["moderator:test:board"] },
            AUTH_SECRET,
          ),
        ),
      )
      .waitForElementNotPresent("#menu");
    browser
      .url(
        withToken(
          SERVER + "/boards/testboard",
          jsonwebtoken.sign(
            { sub: "moderator-colon", roles: ["moderator:test:board"] },
            AUTH_SECRET,
          ),
        ),
      )
      .waitForElementNotPresent("#menu");
    testReadOnlyBoardWithJwt(browser);
  }
  page = testRateLimitAlert(page);
  page.end();
}

module.exports = { beforeEach, testBoard, afterEach };
