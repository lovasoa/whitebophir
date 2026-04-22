const test = require("node:test");
const assert = require("node:assert/strict");

const BoardSvgBaseline = require("../client-data/js/board_svg_baseline.js");

test("buildBoardSvgBaselineUrl preserves the current query string", () => {
  assert.equal(
    BoardSvgBaseline.buildBoardSvgBaselineUrl("/boards/demo", "?token=abc"),
    "/boards/demo.svg?token=abc",
  );
  assert.equal(
    BoardSvgBaseline.buildBoardSvgBaselineUrl("/boards/demo", ""),
    "/boards/demo.svg",
  );
});

test("parseServedBaselineSvgText parses a baseline payload", () => {
  const svgText =
    '<svg id="canvas" data-wbo-seq="12" data-wbo-readonly="true"><g id="drawingArea"><rect id="persisted"></rect></g></svg>';
  let seenMarkup = "";
  const parsed = BoardSvgBaseline.parseServedBaselineSvgText(svgText, {
    parseFromString(markup) {
      seenMarkup = markup;
      return {
        documentElement: {
          getAttribute(/** @type {string} */ name) {
            if (name === "data-wbo-seq") return "12";
            if (name === "data-wbo-readonly") return "true";
            return null;
          },
          querySelector(/** @type {string} */ selector) {
            return selector === "#drawingArea"
              ? { innerHTML: '<rect id="persisted"></rect>' }
              : null;
          },
        },
      };
    },
  });

  assert.equal(seenMarkup, svgText);
  assert.deepEqual(parsed, {
    seq: 12,
    readonly: true,
    drawingAreaMarkup: '<rect id="persisted"></rect>',
  });
});
