import { MutationType } from "../js/mutation_type.js";

/** @import { MountedAppToolsState, ToolBootContext } from "../../types/app-runtime" */

/**
 * @typedef {{
 *   contract: import("./shape_contract.js").ToolContract & {storedTagName: string},
 *   secondary?: {name: string, icon: string, active: boolean, switch?: (state: any) => void},
 *   uidPrefix: string,
 *   isShapeElement: (element: Element | null) => boolean,
 *   makeCreateMessage: (state: any, id: string, x: number, y: number) => any,
 *   makeUpdateMessage: (state: any, x: number, y: number, evt: any) => any,
 *   makeFallbackShape: (update: any) => any,
 *   applyShapeGeometry: (shape: SVGElement, data: any) => void,
 * }} ShapeToolConfig
 */

/**
 * @param {ShapeToolConfig} config
 * @param {ToolBootContext} ctx
 * @returns {any}
 */
export function bootShapeTool(config, ctx) {
  /** @type {any} */
  const state = {
    Tools: /** @type {MountedAppToolsState} */ (ctx.Tools),
    currentShape: null,
    lastTime: performance.now(),
    secondary: null,
    config,
  };
  if (config.secondary) {
    const secondary = config.secondary;
    state.secondary = { ...secondary };
    const switchSecondary = secondary.switch;
    if (typeof switchSecondary === "function") {
      state.secondary.switch = () => switchSecondary(state);
    }
  }
  return state;
}

/**
 * @param {ShapeToolConfig} config
 * @returns {(ctx: ToolBootContext) => any}
 */
export function createShapeToolBoot(config) {
  return (ctx) => bootShapeTool(config, ctx);
}

/**
 * @param {any} state
 * @param {string} id
 * @param {number} x
 * @param {number} y
 * @returns {any}
 */
export function makeSeedShapeCreateMessage(state, id, x, y) {
  return {
    type: MutationType.CREATE,
    id,
    color: state.Tools.getColor(),
    size: state.Tools.getSize(),
    opacity: state.Tools.getOpacity(),
    x,
    y,
    x2: x,
    y2: y,
  };
}

/**
 * @param {any} state
 * @param {any} data
 * @returns {SVGElement}
 */
function createShape(state, data) {
  const { Tools, config } = state;
  const existingShape = Tools.svg.getElementById(data.id);
  const shape = /** @type {SVGElement} */ (
    config.isShapeElement(existingShape)
      ? existingShape
      : Tools.createSVGElement(config.contract.storedTagName)
  );
  shape.id = data.id;
  config.applyShapeGeometry(shape, data);
  shape.setAttribute("stroke", data.color || "black");
  shape.setAttribute("stroke-width", String(data.size || 10));
  shape.setAttribute(
    "opacity",
    String(Math.max(0.1, Math.min(1, data.opacity || 1))),
  );
  if (shape.parentNode !== Tools.drawingArea) {
    Tools.drawingArea.appendChild(shape);
  }
  return shape;
}

/**
 * @param {any} state
 * @param {any} data
 */
export function drawShapeTool(state, data) {
  const { Tools, config } = state;
  Tools.drawingEvent = true;
  if (data.type === MutationType.CREATE) {
    createShape(state, data);
    return;
  }
  if (data.type === MutationType.UPDATE) {
    const existingShape = Tools.svg.getElementById(data.id);
    const shape = /** @type {SVGElement} */ (
      config.isShapeElement(existingShape)
        ? existingShape
        : createShape(state, config.makeFallbackShape(data))
    );
    config.applyShapeGeometry(shape, data);
    return;
  }
  console.error(
    `${config.contract.toolId}: Draw instruction with unknown type. `,
    data,
  );
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 */
export function pressShapeTool(state, x, y, evt) {
  evt.preventDefault();
  const id = state.Tools.generateUID(state.config.uidPrefix);
  state.currentShape = state.config.makeCreateMessage(state, id, x, y);
  state.Tools.drawAndSend(state.currentShape, state.config.contract.toolId);
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent | undefined} evt
 * @param {boolean} [force]
 */
export function moveShapeTool(state, x, y, evt, force = false) {
  if (!state.currentShape) {
    if (evt) evt.preventDefault();
    return;
  }
  const update = state.config.makeUpdateMessage(state, x, y, evt);
  if (!update) return;
  if (performance.now() - state.lastTime > 70 || force) {
    state.Tools.drawAndSend(update, state.config.contract.toolId);
    state.lastTime = performance.now();
  } else {
    drawShapeTool(state, update);
  }
  if (evt) evt.preventDefault();
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 */
export function releaseShapeTool(state, x, y) {
  moveShapeTool(state, x, y, undefined, true);
  state.currentShape = null;
}
