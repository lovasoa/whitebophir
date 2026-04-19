/**
 * @param {Partial<{
 *   id: string,
 *   x: string,
 *   y: string,
 *   fill: string,
 *   fontSize: string,
 *   transform: string,
 *   content: string,
 * }>} [overrides]
 * @returns {{tagName: string, attributes: {[name: string]: string}, content: string}}
 */
function makeStoredTextEntry(overrides) {
  const options = overrides || {};
  return {
    tagName: "text",
    attributes: {
      id: options.id || "text-1",
      x: options.x || "9",
      y: options.y || "10",
      fill: options.fill || "#654321",
      "font-size": options.fontSize || "18",
      ...(options.transform ? { transform: options.transform } : {}),
    },
    content: options.content || "hello &amp; bye",
  };
}

/**
 * @param {Partial<{
 *   id: string,
 *   d: string,
 *   stroke: string,
 *   strokeWidth: string,
 *   transform: string,
 * }>} [overrides]
 * @returns {{tagName: string, attributes: {[name: string]: string}, content: string}}
 */
function makeStoredPencilEntry(overrides) {
  const options = overrides || {};
  return {
    tagName: "path",
    attributes: {
      id: options.id || "line-1",
      d: options.d || "M 1 2 L 1 2 C 1 2 10 12 10 12 C 11 13 18 9 18 9",
      stroke: options.stroke || "#000000",
      "stroke-width": options.strokeWidth || "3",
      ...(options.transform ? { transform: options.transform } : {}),
    },
    content: "",
  };
}

function makeCanonicalTextItem() {
  return {
    id: "text-1",
    tool: "Text",
    x: 10,
    y: 20,
    size: 18,
    color: "#123456",
    txt: "hello",
  };
}

function makeCanonicalPencilItem() {
  return {
    id: "line-1",
    tool: "Pencil",
    color: "#123456",
    size: 4,
    _children: [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ],
  };
}

module.exports = {
  makeCanonicalPencilItem,
  makeCanonicalTextItem,
  makeStoredPencilEntry,
  makeStoredTextEntry,
};
