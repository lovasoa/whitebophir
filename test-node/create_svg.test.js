const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { renderBoard } = require("../server/createSVG.js");

/**
 * @param {any} storedBoard
 * @returns {Promise<string>}
 */
async function renderStoredBoard(storedBoard) {
  const historyDir = await fs.mkdtemp(path.join(os.tmpdir(), "wbo-create-svg-"));
  const file = path.join(historyDir, "board-export.json");
  await fs.writeFile(file, JSON.stringify(storedBoard), "utf8");
  /** @type {string[]} */
  const chunks = [];
  await renderBoard(file, {
    write: function (chunk) {
      chunks.push(chunk);
    },
  });
  return chunks.join("");
}

test("renderBoard normalizes rectangle bounds for reverse-dragged shapes", async function () {
  const svg = await renderStoredBoard({
    rect1: {
      tool: "Rectangle",
      type: "rect",
      id: "rect1",
      color: "#000000",
      size: 2,
      x: 10,
      y: 20,
      x2: 5,
      y2: 1,
    },
  });

  assert.match(svg, /<rect[^>]*x="5"/);
  assert.match(svg, /<rect[^>]*y="1"/);
  assert.match(svg, /<rect[^>]*width="5"/);
  assert.match(svg, /<rect[^>]*height="19"/);
  assert.doesNotMatch(svg, /width="-/);
  assert.doesNotMatch(svg, /height="-/);
});
