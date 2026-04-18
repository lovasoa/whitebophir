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

test("AdmissionIndex stores only minimal pencil summaries after seed and load", async () => {
  const index = createAdmissionIndex({
    loadItems: async () =>
      new Map([
        [
          "line-loaded",
          {
            id: "line-loaded",
            tool: "Pencil",
            _children: [
              { x: 1, y: 2 },
              { x: 3, y: 4 },
            ],
            localBounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
            paintOrder: 3,
          },
        ],
      ]),
  });

  index.seed([
    {
      id: "line-seeded",
      tool: "Pencil",
      childCount: 2,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      localBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      paintOrder: 0,
    },
  ]);
  await index.ensureLoaded(new Set(["line-loaded"]));

  assert.deepEqual(index.get("line-seeded"), {
    id: "line-seeded",
    tool: "Pencil",
    childCount: 2,
    localBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    paintOrder: 0,
  });
  assert.deepEqual(index.get("line-loaded"), {
    id: "line-loaded",
    tool: "Pencil",
    childCount: 2,
    localBounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
    paintOrder: 3,
  });
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

test("AdmissionIndex rejects copy when the source summary is missing", () => {
  const index = createAdmissionIndex();

  assert.deepEqual(
    index.canApplyLoaded({
      tool: "Hand",
      type: "copy",
      id: "missing-rect",
      newid: "copy-1",
    }),
    { ok: false, reason: "copied object does not exist" },
  );
});

test("AdmissionIndex enforces pencil child count limits", () => {
  const index = createAdmissionIndex();
  index.seed([
    {
      id: "line-1",
      tool: "Pencil",
      childCount: 500,
      points: Array.from({ length: 500 }, (_, index) => ({
        x: index,
        y: index,
      })),
      localBounds: { minX: 0, minY: 0, maxX: 499, maxY: 499 },
      paintOrder: 0,
    },
  ]);

  assert.deepEqual(
    index.canApplyLoaded({
      tool: "Pencil",
      type: "child",
      parent: "line-1",
      x: 501,
      y: 501,
    }),
    { ok: false, reason: "too many children" },
  );
});

test("AdmissionIndex rejects Hand batches atomically when one child is invalid", () => {
  const index = createAdmissionIndex();
  index.seed([
    {
      id: "rect-1",
      tool: "Rectangle",
      x: 0,
      y: 0,
      x2: 1000,
      y2: 1000,
      localBounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
      paintOrder: 0,
    },
    {
      id: "rect-2",
      tool: "Rectangle",
      x: 0,
      y: 0,
      x2: 100,
      y2: 100,
      localBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      paintOrder: 1,
    },
  ]);

  assert.deepEqual(
    index.canApplyLoaded({
      tool: "Hand",
      _children: [
        {
          type: "update",
          id: "rect-1",
          transform: { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 },
        },
        {
          type: "delete",
          id: "rect-2",
        },
      ],
    }),
    { ok: false, reason: "shape too large" },
  );
  assert.equal(index.get("rect-2")?.paintOrder, 1);
});
