const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canonicalItemFromItem,
  canonicalItemFromStoredSvgEntry,
  copyCanonicalItem,
  publicItemFromCanonicalItem,
} = require("../server/canonical_board_items.mjs");
const {
  makeCanonicalPencilItem,
  makeCanonicalTextItem,
  makeStoredPencilEntry,
  makeStoredTextEntry,
} = require("./svg_persistence_fixtures.js");

test("canonicalItemFromStoredSvgEntry derives canonical compressed payloads directly from svg entries", () => {
  const text = canonicalItemFromStoredSvgEntry(
    makeStoredTextEntry({
      x: "10",
      y: "20",
      fill: "#123456",
      transform: "matrix(1 0 0 1 7 8)",
      content: "hello &amp; bye",
    }),
    0,
  );
  const pencil = canonicalItemFromStoredSvgEntry(
    makeStoredPencilEntry({
      d: "M 1 2 l 0 0 l 2 2",
      stroke: "#654321",
      strokeWidth: "5",
    }),
    1,
  );

  assert.deepEqual(text.attrs, {
    x: 10,
    y: 20,
    size: 18,
    color: "#123456",
  });
  assert.deepEqual(text.transform, { a: 1, b: 0, c: 0, d: 1, e: 7, f: 8 });
  assert.deepEqual(text.payload, { kind: "text" });
  assert.equal(text.textLength, 11);
  assert.deepEqual(text.bounds, {
    minX: 10,
    minY: 2,
    maxX: 208,
    maxY: 20,
  });
  assert.deepEqual(pencil.attrs, {
    color: "#654321",
    size: 5,
  });
  assert.deepEqual(pencil.payload, {
    kind: "children",
    persistedChildCount: 2,
    appendedChildren: [],
  });
});

test("copyCanonicalItem snapshots compressed payload state at copy time", () => {
  const persistedText = canonicalItemFromItem(makeCanonicalTextItem(), 0, {
    persisted: true,
  });
  const textCopy = copyCanonicalItem(persistedText, "text-2", 1, 123);

  assert.deepEqual(textCopy.copySource, {
    sourceId: "text-1",
  });
  assert.equal(textCopy.payload.modifiedText, undefined);

  const createdPencil = canonicalItemFromItem(makeCanonicalPencilItem(), 0, {
    persisted: false,
  });
  const pencilCopy = copyCanonicalItem(createdPencil, "line-2", 1, 456);

  assert.equal(pencilCopy.copySource, undefined);
  assert.deepEqual(pencilCopy.payload.appendedChildren, [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
  ]);

  createdPencil.payload.appendedChildren.push({ x: 5, y: 6 });
  assert.deepEqual(pencilCopy.payload.appendedChildren, [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
  ]);
});

test("publicItemFromCanonicalItem exposes canonical compressed state instead of pretending the full payload is loaded", () => {
  const item = canonicalItemFromItem(makeCanonicalTextItem(), 0, {
    persisted: true,
  });

  assert.deepEqual(publicItemFromCanonicalItem(item), {
    id: "text-1",
    tool: "text",
    x: 10,
    y: 20,
    size: 18,
    color: "#123456",
    textLength: 5,
  });
});
