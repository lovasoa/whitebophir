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
/** @typedef {keyof typeof TOOL_CODE_BY_ID} ToolId */
/** @typedef {(typeof TOOL_CODE_BY_ID)[ToolId]} ToolCode */

export const TOOL_ID_BY_CODE =
  /** @type {Readonly<Record<ToolCode, ToolId>>} */ (
    Object.freeze(
      Object.fromEntries(
        TOOL_IDS.map((toolId) => [TOOL_CODE_BY_ID[toolId], toolId]),
      ),
    )
  );

export const DRAW_TOOL_IDS = TOOL_IDS.slice(0, 5);
export const TOOLBAR_TOOL_IDS = TOOL_IDS.filter(
  (toolId) => toolId !== "cursor",
);
