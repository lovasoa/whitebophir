const { setup, teardown, writeBoard } = require("./lib/test_helper.js");

let serverProcess, dataPath, serverUrl, tokenQuery;

module.exports = {
  async beforeEach(browser, done) {
    ({
      child: serverProcess,
      dataPath,
      serverUrl,
      tokenQuery,
    } = await setup(browser));
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
      .drawPencilPaths([
        {
          color: "#123456",
          points: [
            { x: 100, y: 200 },
            { x: 300, y: 400 },
          ],
        },
        {
          color: "#abcdef",
          points: [
            { x: 0, y: 0 },
            { x: 90, y: 120 },
            { x: 180, y: 0 },
          ],
        },
      ]);

    browser
      .waitForElementVisible(
        "path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']",
      )
      .waitForElementVisible(
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

  "Test Text Tool Creates Persistent Text"(browser) {
    const board = browser.page.board();
    browser.url(serverUrl + "/boards/text-test?lang=en&" + tokenQuery);

    board
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
      .waitForSavedBoard("text-test", function (storedBoard) {
        return Object.values(storedBoard).some(function (item) {
          return item && item.tool === "Text" && item.txt === "Hello text";
        });
      })
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

  "Test Straight Line Snap Persists"(browser) {
    const board = browser.page.board();
    browser.url(serverUrl + "/boards/line-test?lang=en&" + tokenQuery);

    board
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
      .waitForSavedBoard("line-test", function (storedBoard) {
        return Object.values(storedBoard).some(function (item) {
          return (
            item &&
            item.tool === "Straight line" &&
            Math.abs(item.x2 - 100) < 0.5 &&
            Math.abs(item.y2 - 160) < 0.5
          );
        });
      })
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

  "Test Square Mode Persists"(browser) {
    const board = browser.page.board();
    browser.url(serverUrl + "/boards/rectangle-test?lang=en&" + tokenQuery);

    board
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
      .waitForSavedBoard("rectangle-test", function (storedBoard) {
        return Object.values(storedBoard).some(function (item) {
          return (
            item &&
            item.tool === "Rectangle" &&
            item.x === 100 &&
            item.y === 100 &&
            item.x2 === 160 &&
            item.y2 === 160
          );
        });
      })
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

  "Test Eraser Removes Persistent Shape"(browser) {
    const board = browser.page.board();
    browser.perform(async function (done) {
      await writeBoard(dataPath, "eraser-test", {
        "erase-rect": {
          type: "rect",
          id: "erase-rect",
          tool: "Rectangle",
          x: 100,
          y: 100,
          x2: 160,
          y2: 140,
          color: "#123456",
          size: 4,
        },
      });
      done();
    });

    browser.url(serverUrl + "/boards/eraser-test?lang=en&" + tokenQuery);

    board
      .waitForElementVisible("#toolID-Eraser")
      .waitForElementVisible("#erase-rect")
      .click("#toolID-Eraser")
      .executeAsync(
        function (done) {
          var rect = document.getElementById("erase-rect");
          var evt = {
            preventDefault: function () {},
            target: rect,
          };

          Tools.curTool.listeners.press(110, 110, evt);
          Tools.curTool.listeners.release(110, 110, evt);

          setTimeout(function () {
            done({
              erased: document.getElementById("erase-rect") === null,
            });
          }, 150);
        },
        function (result) {
          browser.assert.equal(result.value.erased, true);
        },
      )
      .waitForSavedBoard("eraser-test", function (storedBoard) {
        return !Object.prototype.hasOwnProperty.call(storedBoard, "erase-rect");
      })
      .refresh()
      .waitForElementVisible("#toolID-Eraser")
      .assert.not.elementPresent("#erase-rect")
      .end();
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
