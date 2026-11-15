const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { renderBoard } = require("../server/persistence/create_svg.mjs");

/**
 * @param {any} storedBoard
 * @returns {Promise<string>}
 */
async function renderStoredBoard(storedBoard) {
  const historyDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-create-svg-"),
  );
  const file = path.join(historyDir, "board-export.json");
  try {
    await fs.writeFile(file, JSON.stringify(storedBoard), "utf8");
    /** @type {string[]} */
    const chunks = [];
    await renderBoard(file, { write: (chunk) => chunks.push(chunk) });
    return chunks.join("");
  } finally {
    await fs.rm(historyDir, { recursive: true, force: true });
  }
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
      tool: "rectangle",
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
      tool: "pencil",
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

test("legacy exports preserve ellipse, line, and text geometry and display defaults", async () => {
  const style = {
    size: 2,
    color: "#123456",
    opacity: 0.5,
    deltax: 3,
    deltay: 4,
  };
  const svg = await renderStoredBoard({
    ellipse: {
      ...style,
      tool: "ellipse",
      id: "e",
      x: 10,
      y: 10,
      x2: 40,
      y2: 30,
    },
    line: {
      ...style,
      tool: "straight-line",
      id: "l",
      x: 10,
      y: 10,
      x2: 50,
      y2: 30,
    },
    text: {
      ...style,
      tool: "text",
      color: undefined,
      x: 10,
      y: 40,
      txt: '<hello> & "world"',
    },
  });

  assert.match(svg, /<ellipse[^>]*cx="250" cy="200" rx="150" ry="100"/);
  assert.match(svg, /<line[^>]*x1="100" y1="100" x2="500" y2="300"/);
  assert.match(
    svg,
    /<text id="t" x="100" y="400" font-size="20" fill="#000000"/,
  );
  assert.match(svg, /&#60;hello&#62; &#38; &#34;world&#34;<\/text>/);
  assert.equal(svg.match(/transform="matrix\(1 0 0 1 30 40\)"/g)?.length, 3);
  assert.equal(svg.match(/opacity="0.5"/g)?.length, 2);
  assert.match(svg, /path, line \{[^}]*stroke-linecap:round/);
});
