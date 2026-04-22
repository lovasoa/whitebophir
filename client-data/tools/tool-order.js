export const TOOL_IDS = [
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
];

export const DRAW_TOOL_IDS = TOOL_IDS.slice(0, 5);
export const TOOLBAR_TOOL_IDS = TOOL_IDS.filter(
  (toolId) => toolId !== "cursor",
);
