export const DRAW_TOOL_NAMES = [
  "Pencil",
  "Straight line",
  "Rectangle",
  "Ellipse",
  "Text",
];

export function isShapeTool(toolName) {
  return (
    toolName === "Straight line" ||
    toolName === "Rectangle" ||
    toolName === "Ellipse"
  );
}
