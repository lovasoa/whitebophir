export const TOOL_CODE_BY_ID = Object.freeze(
  /** @type {const} */ ({
    pencil: 1,
    "straight-line": 2,
    rectangle: 3,
    ellipse: 4,
    text: 5,
    eraser: 6,
    hand: 7,
    grid: 8,
    download: 9,
    zoom: 10,
    clear: 11,
    cursor: 12,
  }),
);

export const TOOL_IDS =
  /** @type {ReadonlyArray<keyof typeof TOOL_CODE_BY_ID>} */ (
    Object.keys(TOOL_CODE_BY_ID)
  );

export const ToolCodes = Object.freeze(
  /** @type {const} */ ({
    PENCIL: TOOL_CODE_BY_ID.pencil,
    STRAIGHT_LINE: TOOL_CODE_BY_ID["straight-line"],
    RECTANGLE: TOOL_CODE_BY_ID.rectangle,
    ELLIPSE: TOOL_CODE_BY_ID.ellipse,
    TEXT: TOOL_CODE_BY_ID.text,
    ERASER: TOOL_CODE_BY_ID.eraser,
    HAND: TOOL_CODE_BY_ID.hand,
    GRID: TOOL_CODE_BY_ID.grid,
    DOWNLOAD: TOOL_CODE_BY_ID.download,
    ZOOM: TOOL_CODE_BY_ID.zoom,
    CLEAR: TOOL_CODE_BY_ID.clear,
    CURSOR: TOOL_CODE_BY_ID.cursor,
  }),
);

export const DRAW_TOOL_IDS = TOOL_IDS.slice(0, 5);
export const TOOLBAR_TOOL_IDS = TOOL_IDS.filter(
  (toolId) => toolId !== "cursor",
);
