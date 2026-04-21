import ellipseContract from "./ellipse/contract.js";
import pencilContract from "./pencil/contract.js";
import rectangleContract from "./rectangle/contract.js";
import straightLineContract from "./straight-line/contract.js";
import textContract from "./text/contract.js";

/** @typedef {import("./shape_contract.js").ToolContract} ToolContract */

/** @type {Record<string, ToolContract>} */
const TOOL_CONTRACTS_BY_NAME = {
  [pencilContract.toolName]: pencilContract,
  [straightLineContract.toolName]: straightLineContract,
  [rectangleContract.toolName]: rectangleContract,
  [ellipseContract.toolName]: ellipseContract,
  [textContract.toolName]: textContract,
};

/** @type {Record<string, ToolContract>} */
const TOOL_CONTRACTS_BY_TAG = Object.fromEntries(
  Object.values(TOOL_CONTRACTS_BY_NAME).map((contract) => [
    contract.storedTagName,
    contract,
  ]),
);

export { TOOL_CONTRACTS_BY_NAME, TOOL_CONTRACTS_BY_TAG };
