const { setup, teardown, writeBoard } = require("./lib/test_helper.js");

let serverProcess, dataPath, serverUrl, tokenQuery;

module.exports = {
  async before(browser, done) {
    ({
      child: serverProcess,
      dataPath,
      serverUrl,
      tokenQuery,
    } = await setup(browser));
    done();
  },

  async after(browser, done) {
    await teardown(serverProcess, done, browser);
  },

  "Test Selector Moves Existing Rectangle"(browser) {
    const board = browser.page.board();
    browser.perform(async function (done) {
      await writeBoard(dataPath, "selector-test", {
        "seed-rect": {
          type: "rect",
          id: "seed-rect",
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

    browser.url(serverUrl + "/boards/selector-test?lang=en&" + tokenQuery);

    board
      .waitForElementVisible("#toolID-Hand")
      .waitForElementVisible("#seed-rect")
      .click("#toolID-Hand")
      .executeAsync(
        function (done) {
          function readTranslation(rect) {
            var transform = rect.getAttribute("transform") || "";
            var values = (transform.match(/matrix\(([^)]+)\)/) || ["", ""])[1]
              .split(/[ ,]+/)
              .filter(Boolean)
              .map(Number);
            return {
              transform: transform,
              e: values[4],
              f: values[5],
            };
          }

          var rect = document.getElementById("seed-rect");
          var evt = {
            preventDefault: function () {},
            target: rect,
            clientX: 0,
            clientY: 0,
          };

          Tools.curTool.listeners.press(110, 110, evt);
          Tools.curTool.listeners.move(150, 135, evt);
          Tools.curTool.listeners.release(150, 135, evt);

          setTimeout(function () {
            done({
              selectorActive: Tools.curTool.secondary.active,
              translation: readTranslation(rect),
            });
          }, 150);
        },
        function (result) {
          browser.assert.equal(result.value.selectorActive, true);
          browser.assert.equal(result.value.translation.e, 40);
          browser.assert.equal(result.value.translation.f, 25);
        },
      )
      .waitForSavedBoard("selector-test", function (storedBoard) {
        var rect = storedBoard["seed-rect"];
        return (
          rect &&
          rect.transform &&
          rect.transform.e === 40 &&
          rect.transform.f === 25
        );
      })
      .refresh()
      .waitForElementVisible("#seed-rect")
      .execute(
        function () {
          var rect = document.getElementById("seed-rect");
          var transform = rect.getAttribute("transform") || "";
          var values = (transform.match(/matrix\(([^)]+)\)/) || ["", ""])[1]
            .split(/[ ,]+/)
            .filter(Boolean)
            .map(Number);
          return {
            transform: transform,
            e: values[4],
            f: values[5],
          };
        },
        [],
        function (result) {
          browser.assert.equal(result.value.e, 40);
          browser.assert.equal(result.value.f, 25);
        },
      )
      .end();
  },

  "Test Zoom Click In And Out"(browser) {
    const board = browser.page.board();
    browser.url(serverUrl + "/boards/zoom-test?lang=en&" + tokenQuery);

    board
      .waitForElementVisible("#toolID-Zoom")
      .click("#toolID-Zoom")
      .executeAsync(
        function (done) {
          var zoomInEvent = {
            preventDefault: function () {},
            clientY: 100,
            shiftKey: false,
          };

          Tools.curTool.listeners.press(200, 200, zoomInEvent);
          Tools.curTool.listeners.release(200, 200, zoomInEvent);

          setTimeout(function () {
            var scaleAfterZoomIn = Tools.getScale();
            var zoomOutEvent = {
              preventDefault: function () {},
              clientY: 100,
              shiftKey: true,
            };

            Tools.curTool.listeners.press(200, 200, zoomOutEvent);
            Tools.curTool.listeners.release(200, 200, zoomOutEvent);

            setTimeout(function () {
              done({
                scaleAfterZoomIn: scaleAfterZoomIn,
                scaleAfterZoomOut: Tools.getScale(),
              });
            }, 50);
          }, 50);
        },
        function (result) {
          browser.assert.ok(
            Math.abs(result.value.scaleAfterZoomIn - 1.5) < 0.01,
          );
          browser.assert.ok(
            Math.abs(result.value.scaleAfterZoomOut - 0.75) < 0.01,
          );
        },
      )
      .end();
  },

  "Test Download Exports SVG Content"(browser) {
    const board = browser.page.board();
    browser.perform(async function (done) {
      await writeBoard(dataPath, "download-test", {
        "download-rect": {
          type: "rect",
          id: "download-rect",
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

    browser.url(serverUrl + "/boards/download-test?lang=en&" + tokenQuery);

    board
      .waitForElementVisible("#toolID-Download")
      .waitForElementVisible("#download-rect")
      .execute(function () {
        window.__downloadCapture = null;
        window.__downloadAnchorClicks = 0;
        window.URL.createObjectURL = function (blob) {
          window.__downloadBlob = blob;
          return "blob:test-download";
        };
        window.URL.revokeObjectURL = function () {};
        HTMLAnchorElement.prototype.click = function () {
          window.__downloadAnchorClicks++;
          window.__downloadCapture = {
            href: this.getAttribute("href"),
            download: this.getAttribute("download"),
          };
        };
      })
      .click("#toolID-Download")
      .executeAsync(
        async function (done) {
          var text = await window.__downloadBlob.text();
          done({
            clicks: window.__downloadAnchorClicks,
            href: window.__downloadCapture && window.__downloadCapture.href,
            download:
              window.__downloadCapture && window.__downloadCapture.download,
            hasSvgTag: text.includes("<svg"),
            hasRect: text.includes('id="download-rect"'),
            hasBoardStyles: text.includes("#drawingArea"),
          });
        },
        function (result) {
          browser.assert.equal(result.value.clicks, 1);
          browser.assert.equal(result.value.href, "blob:test-download");
          browser.assert.equal(result.value.download, "download-test.svg");
          browser.assert.equal(result.value.hasSvgTag, true);
          browser.assert.equal(result.value.hasRect, true);
          browser.assert.equal(result.value.hasBoardStyles, true);
        },
      )
      .end();
  },

  "Test Selector Duplicate And Delete Persist"(browser) {
    const board = browser.page.board();
    browser.perform(async function (done) {
      await writeBoard(dataPath, "selector-advanced-test", {
        "seed-rect": {
          type: "rect",
          id: "seed-rect",
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

    browser.url(
      serverUrl + "/boards/selector-advanced-test?lang=en&" + tokenQuery,
    );

    board
      .waitForElementVisible("#toolID-Hand")
      .waitForElementVisible("#seed-rect")
      .click("#toolID-Hand")
      .executeAsync(
        function (done) {
          function rectState() {
            return Array.from(
              document.querySelectorAll("#drawingArea rect"),
            ).map(function (rect) {
              return rect.id;
            });
          }

          var rect = document.getElementById("seed-rect");
          var evt = {
            preventDefault: function () {},
            target: rect,
            clientX: 0,
            clientY: 0,
          };

          Tools.curTool.listeners.press(110, 110, evt);
          Tools.curTool.listeners.release(110, 110, evt);
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "d", bubbles: true }),
          );

          setTimeout(function () {
            var afterDuplicate = rectState();
            document.body.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
            );

            setTimeout(function () {
              done({
                afterDuplicate: afterDuplicate,
                afterDelete: rectState(),
              });
            }, 150);
          }, 150);
        },
        function (result) {
          browser.assert.equal(result.value.afterDuplicate.length, 2);
          browser.assert.equal(
            result.value.afterDuplicate.includes("seed-rect"),
            true,
          );
          browser.assert.equal(result.value.afterDelete.length, 1);
          browser.assert.equal(
            result.value.afterDelete[0] === "seed-rect",
            false,
          );
        },
      )
      .waitForSavedBoard("selector-advanced-test", function (storedBoard) {
        var ids = Object.keys(storedBoard).filter(function (id) {
          return id !== "__wbo_meta__";
        });
        return ids.length === 1 && ids[0] !== "seed-rect";
      })
      .refresh()
      .waitForElementVisible("#drawingArea rect")
      .execute(
        function () {
          return Array.from(document.querySelectorAll("#drawingArea rect")).map(
            function (rect) {
              return rect.id;
            },
          );
        },
        [],
        function (result) {
          browser.assert.equal(result.value.length, 1);
          browser.assert.equal(result.value[0] === "seed-rect", false);
        },
      )
      .end();
  },
};
