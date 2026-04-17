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

test("parseServedBaselineSvgDocument extracts seq, readonly, and drawing area markup", () => {
  const parsed = BoardSvgBaseline.parseServedBaselineSvgDocument({
    documentElement: {
      getAttribute(name) {
        if (name === "data-wbo-seq") return "12";
        if (name === "data-wbo-readonly") return "true";
        return null;
      },
      querySelector(selector) {
        if (selector === "#drawingArea") {
          return { innerHTML: '<rect id="persisted"></rect>' };
        }
        return null;
      },
    },
  });

  assert.deepEqual(parsed, {
    seq: 12,
    readonly: true,
    drawingAreaMarkup: '<rect id="persisted"></rect>',
  });
});

test("parseServedBaselineSvgText delegates to the provided DOM parser", () => {
  let seenMarkup = "";
  let seenMimeType = "";
  const parsed = BoardSvgBaseline.parseServedBaselineSvgText("<svg></svg>", {
    parseFromString(markup, mimeType) {
      seenMarkup = markup;
      seenMimeType = mimeType;
      return {
        documentElement: {
          getAttribute(/** @type {string} */ name) {
            if (name === "data-wbo-seq") return "3";
            if (name === "data-wbo-readonly") return "false";
            return null;
          },
          querySelector(/** @type {string} */ selector) {
            return selector === "#drawingArea"
              ? { innerHTML: '<path id="line"></path>' }
              : null;
          },
        },
      };
    },
  });

  assert.equal(seenMarkup, "<svg></svg>");
  assert.equal(seenMimeType, "image/svg+xml");
  assert.deepEqual(parsed, {
    seq: 3,
    readonly: false,
    drawingAreaMarkup: '<path id="line"></path>',
  });
});
