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

export const DRAW_TOOL_IDS = TOOL_IDS.slice(0, 5);
export const TOOLBAR_TOOL_IDS = TOOL_IDS.filter(
  (toolId) => toolId !== "cursor",
);
