import EllipseTool from "./ellipse/ellipse.js";
import PencilTool from "./pencil/pencil.js";
import RectangleTool from "./rectangle/rectangle.js";
import StraightLineTool from "./straight-line/straight-line.js";
import TextTool from "./text/text.js";
/** @typedef {import("./shape_contract.js").ToolContract} ToolContract */

const TOOL_CONTRACTS = [
  /** @type {ToolContract} */ (PencilTool.contract),
  /** @type {ToolContract} */ (StraightLineTool.contract),
  /** @type {ToolContract} */ (RectangleTool.contract),
  /** @type {ToolContract} */ (EllipseTool.contract),
  /** @type {ToolContract} */ (TextTool.contract),
];

/** @type {Record<string, ToolContract>} */
const TOOL_CONTRACTS_BY_NAME = Object.fromEntries(
  TOOL_CONTRACTS.map((contract) => [contract.toolName, contract]),
);

/** @type {Record<string, ToolContract>} */
const TOOL_CONTRACTS_BY_TAG = Object.fromEntries(
  TOOL_CONTRACTS.filter(
    (contract) => typeof contract.storedTagName === "string",
  ).map((contract) => [contract.storedTagName, contract]),
);
export { TOOL_CONTRACTS_BY_NAME, TOOL_CONTRACTS_BY_TAG };
