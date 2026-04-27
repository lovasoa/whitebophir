export const TOOL_IDS = /** @type {const} */ ([
  "pencil",
  "straight-line",
  "rectangle",
  "ellipse",
  "text",
  "eraser",
  "hand",
  "grid",
  "download",
  "zoom",
  "clear",
  "cursor",
]);

export const ToolCodes = Object.freeze(
  /** @type {const} */ ({
    PENCIL: 1,
    STRAIGHT_LINE: 2,
    RECTANGLE: 3,
    ELLIPSE: 4,
    TEXT: 5,
    ERASER: 6,
    HAND: 7,
    GRID: 8,
    DOWNLOAD: 9,
    ZOOM: 10,
    CLEAR: 11,
    CURSOR: 12,
  }),
);

export const DRAW_TOOL_IDS = TOOL_IDS.slice(0, 5);
export const TOOLBAR_TOOL_IDS = TOOL_IDS.filter(
  (toolId) => toolId !== "cursor",
);
