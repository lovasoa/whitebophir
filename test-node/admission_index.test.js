const test = require("node:test");
const assert = require("node:assert/strict");

const { createAdmissionIndex } = require("../server/admission_index.mjs");

test("AdmissionIndex ensureLoaded hydrates only missing ids", async () => {
  /** @type {string[][]} */
  const loads = [];
  const index = createAdmissionIndex({
    loadItems: async (ids) => {
      const requested = [...ids].sort();
      loads.push(requested);
      return new Map(
        requested.map((id, offset) => [
          id,
          {
            id,
            tool: "Rectangle",
            x: offset,
            y: offset,
            x2: offset + 10,
            y2: offset + 10,
            localBounds: {
              minX: offset,
              minY: offset,
              maxX: offset + 10,
              maxY: offset + 10,
            },
            paintOrder: offset,
          },
        ]),
      );
    },
  });

  await index.ensureLoaded(new Set(["rect-1", "rect-2"]));
  await index.ensureLoaded(new Set(["rect-2", "rect-3"]));

  assert.deepEqual(loads, [["rect-1", "rect-2"], ["rect-3"]]);
  assert.equal(index.get("rect-1")?.paintOrder, 0);
  assert.equal(index.get("rect-3")?.paintOrder, 0);
});

test("AdmissionIndex rejects oversized text updates using loaded summaries", () => {
  const index = createAdmissionIndex();
  index.seed([
    {
      id: "text-1",
      tool: "Text",
      x: 0,
      y: 0,
      size: 20,
      txt: "ok",
      localBounds: {
        minX: 0,
        minY: 0,
        maxX: 30,
        maxY: 20,
      },
      paintOrder: 0,
    },
  ]);

  assert.deepEqual(
    index.canApplyLoaded({
      tool: "Text",
      type: "update",
      id: "text-1",
      txt: "x".repeat(50000),
    }),
    { ok: false, reason: "shape too large" },
  );
});

test("AdmissionIndex rejects pencil growth after an oversized transform", () => {
  const index = createAdmissionIndex();
  index.seed([
    {
      id: "line-1",
      tool: "Pencil",
      childCount: 2,
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ],
      transform: { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 },
      localBounds: {
        minX: 0,
        minY: 0,
        maxX: 1000,
        maxY: 0,
      },
      paintOrder: 0,
    },
  ]);

  assert.deepEqual(
    index.canApplyLoaded({
      tool: "Pencil",
      type: "child",
      parent: "line-1",
      x: 1100,
      y: 0,
    }),
    { ok: false, reason: "shape too large" },
  );
});

test("AdmissionIndex applyAccepted preserves paint-order semantics", () => {
  const index = createAdmissionIndex();
  index.seed([
    {
      id: "rect-1",
      tool: "Rectangle",
      x: 0,
      y: 0,
      x2: 10,
      y2: 10,
      localBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      paintOrder: 0,
    },
    {
      id: "text-1",
      tool: "Text",
      x: 20,
      y: 20,
      size: 18,
      txt: "hi",
      localBounds: { minX: 20, minY: 20, maxX: 30, maxY: 38 },
      paintOrder: 1,
    },
  ]);

  index.applyAccepted({
    tool: "Rectangle",
    type: "update",
    id: "rect-1",
    x2: 30,
    y2: 40,
  });
  index.applyAccepted({
    tool: "Hand",
    type: "copy",
    id: "rect-1",
    newid: "rect-2",
  });
  index.applyAccepted({
    tool: "Eraser",
    type: "delete",
    id: "text-1",
  });

  assert.equal(index.get("rect-1")?.paintOrder, 0);
  assert.equal(index.get("rect-2")?.paintOrder, 2);
  assert.equal(index.get("text-1"), undefined);

  index.applyAccepted({ tool: "Clear", type: "clear" });
  assert.equal(index.get("rect-1"), undefined);
  assert.equal(index.get("rect-2"), undefined);
});
