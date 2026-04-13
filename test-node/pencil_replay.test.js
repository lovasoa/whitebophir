const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const PENCIL_POINT_PATH = path.join(
  __dirname,
  "..",
  "client-data",
  "tools",
  "pencil",
  "wbo_pencil_point.js",
);
const PENCIL_TOOL_PATH = path.join(
  __dirname,
  "..",
  "client-data",
  "tools",
  "pencil",
  "pencil.js",
);

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function createPathElement() {
  return {
    id: "",
    attributes: {},
    pathData: [],
    setAttribute: function (name, value) {
      this.attributes[name] = value;
    },
    getPathData: function () {
      return this.pathData.slice().map(function (seg) {
        return { type: seg.type, values: seg.values.slice() };
      });
    },
    setPathData: function (pathData) {
      this.pathData = pathData.map(function (seg) {
        return { type: seg.type, values: seg.values.slice() };
      });
    },
  };
}

test("Pencil replay resets an existing path before reapplying children", function () {
  clearModule(PENCIL_POINT_PATH);
  clearModule(PENCIL_TOOL_PATH);

  global.performance = { now: function () { return 0; } };

  const drawingArea = {
    appendChild: function () {},
  };
  const elementsById = new Map();
  const svg = {
    getElementById: function (id) {
      return elementsById.get(id) || null;
    },
  };

  let pencilTool;
  global.Tools = {
    svg: svg,
    drawingArea: drawingArea,
    drawingEvent: false,
    server_config: {
      MAX_EMIT_COUNT_PERIOD: 1000,
      MAX_EMIT_COUNT: 10,
      AUTO_FINGER_WHITEOUT: false,
    },
    curTool: { secondary: { active: false } },
    getColor: function () {
      return "#123456";
    },
    getSize: function () {
      return 4;
    },
    getOpacity: function () {
      return 1;
    },
    generateUID: function () {
      return "line-1";
    },
    change: function () {},
    createSVGElement: function () {
      const element = createPathElement();
      const originalSetId = Object.getOwnPropertyDescriptor(element, "id");
      Object.defineProperty(element, "id", {
        get: function () {
          return this._id || "";
        },
        set: function (value) {
          this._id = value;
          elementsById.set(value, this);
        },
        configurable: true,
        enumerable: true,
      });
      if (originalSetId && originalSetId.value) element.id = originalSetId.value;
      return element;
    },
    add: function (tool) {
      pencilTool = tool;
    },
  };

  global.wboPencilPoint = require(PENCIL_POINT_PATH).wboPencilPoint;
  require(PENCIL_TOOL_PATH);

  pencilTool.draw({
    type: "line",
    id: "line-1",
    color: "#123456",
    size: 4,
    opacity: 1,
  });
  pencilTool.draw({ type: "child", parent: "line-1", x: 100, y: 200 });
  pencilTool.draw({ type: "child", parent: "line-1", x: 300, y: 400 });

  const line = elementsById.get("line-1");
  assert.deepEqual(line.pathData, [
    { type: "M", values: [100, 200] },
    { type: "L", values: [100, 200] },
    { type: "C", values: [100, 200, 300, 400, 300, 400] },
  ]);

  pencilTool.draw({
    type: "line",
    id: "line-1",
    color: "#123456",
    size: 4,
    opacity: 1,
  });
  pencilTool.draw({ type: "child", parent: "line-1", x: 100, y: 200 });
  pencilTool.draw({ type: "child", parent: "line-1", x: 300, y: 400 });

  assert.deepEqual(line.pathData, [
    { type: "M", values: [100, 200] },
    { type: "L", values: [100, 200] },
    { type: "C", values: [100, 200, 300, 400, 300, 400] },
  ]);
});
