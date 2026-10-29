const test = require("node:test");
const assert = require("node:assert/strict");

const {
  finalizePersistedCanonicalItems,
  getCanonicalItem,
  removeCanonicalItem,
  upsertCanonicalItem,
} = require("../server/board/canonical_index.mjs");
const {
  cloneCanonicalItem,
  copyCanonicalItem,
  canonicalItemFromItem,
} = require("../server/board/canonical_items.mjs");

function createState() {
  return {
    itemsById: new Map(),
    paintOrder: [],
    nextPaintOrder: 0,
    liveItemCount: 0,
    trimPaintOrderIndex: 0,
  };
}

test("canonical index tracks paint order through upsert/remove", () => {
  const state = createState();
  const created = canonicalItemFromItem(
    {
      id: "rect-1",
      tool: "rectangle",
      color: "#123456",
      size: 2,
      x: 1,
      y: 2,
      x2: 5,
      y2: 6,
    },
    0,
    { persisted: false },
  );

  upsertCanonicalItem(state, created);

  assert.equal(getCanonicalItem(state, "rect-1")?.id, "rect-1");
  assert.deepEqual(state.paintOrder, ["rect-1"]);
  assert.equal(state.nextPaintOrder, 1);

  removeCanonicalItem(state, "rect-1");

  assert.equal(getCanonicalItem(state, "rect-1"), undefined);
  assert.equal(state.itemsById.get("rect-1")?.deleted, true);
});

test("finalizePersistedCanonicalItems clears persisted dirtiness and folds child counts", () => {
  const state = createState();
  const persistedPencil = canonicalItemFromItem(
    {
      id: "line-1",
      tool: "pencil",
      color: "#123456",
      size: 4,
      _children: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    0,
    { persisted: true },
  );

  upsertCanonicalItem(state, persistedPencil);
  const dirty = cloneCanonicalItem(persistedPencil);
  dirty.dirty = true;
  dirty.payload.appendedChildren.push({ x: 5, y: 6 });
  state.itemsById.set(dirty.id, dirty);

  finalizePersistedCanonicalItems(state);

  const finalized = state.itemsById.get("line-1");
  assert.equal(finalized.dirty, false);
  assert.equal(finalized.payload.persistedChildCount, 3);
  assert.deepEqual(finalized.payload.appendedChildren, []);
});

test("finalizePersistedCanonicalItems preserves source-independent text copies", () => {
  const state = createState();
  const source = canonicalItemFromItem(
    {
      id: "text-1",
      tool: "text",
      x: 10,
      y: 20,
      size: 18,
      color: "#123456",
      txt: "hello",
    },
    0,
    { persisted: true },
  );
  const copy = copyCanonicalItem(source, "text-2", 1, 123);
  copy.copySource = { sourceId: "text-1" };

  upsertCanonicalItem(state, source);
  upsertCanonicalItem(state, copy);

  finalizePersistedCanonicalItems(state);

  const finalized = state.itemsById.get("text-2");
  assert.equal(finalized.dirty, false);
  assert.equal(finalized.copySource, undefined);
});
