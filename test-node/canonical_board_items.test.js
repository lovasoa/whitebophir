const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canonicalItemFromItem,
  canonicalItemFromStoredSvgEntry,
  copyCanonicalItem,
  materializeItemForSave,
  publicItemFromCanonicalItem,
} = require("../server/canonical_board_items.mjs");

test("canonicalItemFromStoredSvgEntry derives canonical compressed payloads directly from svg entries", () => {
  const text = canonicalItemFromStoredSvgEntry(
    {
      tagName: "text",
      attributes: {
        id: "text-1",
        x: "10",
        y: "20",
        "font-size": "18",
        fill: "#123456",
      },
      content: "hello &amp; bye",
    },
    0,
  );
  const pencil = canonicalItemFromStoredSvgEntry(
    {
      tagName: "path",
      attributes: {
        id: "line-1",
        d: "M 1 2 L 1 2 C 1 2 3 4 3 4",
        stroke: "#654321",
        "stroke-width": "5",
      },
      content: "",
    },
    1,
  );

  assert.deepEqual(text.attrs, {
    x: 10,
    y: 20,
    size: 18,
    color: "#123456",
  });
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
  const persistedText = canonicalItemFromItem(
    {
      id: "text-1",
      tool: "Text",
      x: 10,
      y: 20,
      size: 18,
      color: "#123456",
      txt: "hello",
    },
    0,
    { persisted: true },
  );
  const textCopy = copyCanonicalItem(persistedText, "text-2", 1, 123);

  assert.deepEqual(textCopy.copySource, {
    sourceId: "text-1",
    sourcePayloadKind: "text",
  });
  assert.equal(textCopy.payload.modifiedText, undefined);

  const createdPencil = canonicalItemFromItem(
    {
      id: "line-1",
      tool: "Pencil",
      color: "#123456",
      size: 4,
      _children: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    0,
    { persisted: false },
  );
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

test("materializeItemForSave reconstructs compressed payloads from source payload only during save", () => {
  const persistedText = canonicalItemFromItem(
    {
      id: "text-1",
      tool: "Text",
      x: 10,
      y: 20,
      size: 18,
      color: "#123456",
      txt: "hello",
    },
    0,
    { persisted: true },
  );
  const persistedPencil = canonicalItemFromItem(
    {
      id: "line-1",
      tool: "Pencil",
      color: "#123456",
      size: 4,
      _children: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    1,
    { persisted: true },
  );
  persistedPencil.payload.appendedChildren.push({ x: 5, y: 6 });

  assert.deepEqual(materializeItemForSave(persistedText, { txt: "hello" }), {
    id: "text-1",
    tool: "Text",
    x: 10,
    y: 20,
    size: 18,
    color: "#123456",
    txt: "hello",
  });
  assert.deepEqual(
    materializeItemForSave(persistedPencil, {
      _children: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    }),
    {
      id: "line-1",
      tool: "Pencil",
      color: "#123456",
      size: 4,
      _children: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ],
    },
  );
});

test("publicItemFromCanonicalItem exposes canonical compressed state instead of pretending the full payload is loaded", () => {
  const item = canonicalItemFromItem(
    {
      id: "text-1",
      tool: "Text",
      x: 10,
      y: 20,
      size: 18,
      color: "#123456",
      txt: "hello",
    },
    0,
    { persisted: true },
  );

  assert.deepEqual(publicItemFromCanonicalItem(item), {
    id: "text-1",
    tool: "Text",
    x: 10,
    y: 20,
    size: 18,
    color: "#123456",
    textLength: 5,
  });
});
