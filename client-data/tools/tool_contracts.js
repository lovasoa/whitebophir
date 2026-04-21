import EllipseTool from "./ellipse/ellipse.js";
import { TOOL_CATALOG } from "../js/tool_catalog.js";
import pencilContract from "./pencil/contract.js";
import RectangleTool from "./rectangle/rectangle.js";
import StraightLineTool from "./straight-line/straight-line.js";
import textContract from "./text/contract.js";
/** @typedef {import("./shape_contract.js").ToolContract} ToolContract */

const TOOL_CONTRACTS = [
  pencilContract,
  /** @type {ToolContract} */ (StraightLineTool.contract),
  /** @type {ToolContract} */ (RectangleTool.contract),
  /** @type {ToolContract} */ (EllipseTool.contract),
  textContract,
];

/** @type {Record<string, ToolContract>} */
const TOOL_CONTRACTS_BY_NAME = Object.fromEntries(
  TOOL_CONTRACTS.map((contract) => [contract.toolName, contract]),
);

/** @type {Record<string, ToolContract>} */
const TOOL_CONTRACTS_BY_TAG = Object.fromEntries(
  TOOL_CATALOG.filter((entry) => typeof entry.storedTagName === "string").map(
    (entry) => [entry.storedTagName, TOOL_CONTRACTS_BY_NAME[entry.name]],
  ),
);
export { TOOL_CONTRACTS_BY_NAME, TOOL_CONTRACTS_BY_TAG };
