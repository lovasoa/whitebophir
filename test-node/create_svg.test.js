const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { renderBoard } = require("../server/createSVG.mjs");

/**
 * @param {any} storedBoard
 * @returns {Promise<string>}
 */
async function renderStoredBoard(storedBoard) {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-create-svg-"),
  );
  const file = path.join(historyDir, "board-export.json");
  await fs.writeFile(file, JSON.stringify(storedBoard), "utf8");
  /** @type {string[]} */
  const chunks = [];
  await renderBoard(file, {
    write: (chunk) => {
      chunks.push(chunk);
    },
  });
  return chunks.join("");
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {{x: number, y: number}[]} points
 * @returns {string}
 */
function renderExpectedPencilPath(points) {
  if (!points.length) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const point = points[i];
    path += ` l ${point.x - prev.x} ${point.y - prev.y}`;
  }
  return path;
}

test("renderBoard normalizes rectangle bounds for reverse-dragged shapes", async () => {
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

  assert.match(svg, /<rect[^>]*x="50"/);
  assert.match(svg, /<rect[^>]*y="10"/);
  assert.match(svg, /<rect[^>]*width="50"/);
  assert.match(svg, /<rect[^>]*height="190"/);
  assert.doesNotMatch(svg, /width="-/);
  assert.doesNotMatch(svg, /height="-/);
});

test("renderBoard stores raw pencil path points for client-side smoothing", async () => {
  const points = [
    { x: 1, y: 2 },
    { x: 10, y: 12 },
    { x: 18, y: 9 },
    { x: 25, y: 30 },
  ];
  const svg = await renderStoredBoard({
    line1: {
      tool: "Pencil",
      type: "line",
      id: "line1",
      color: "#000000",
      size: 2,
      _children: points,
    },
  });

  const expectedPath = renderExpectedPencilPath(
    points.map((point) => ({ x: point.x * 10, y: point.y * 10 })),
  );
  assert.match(svg, new RegExp(`d="${escapeRegExp(expectedPath)}"`));
});
