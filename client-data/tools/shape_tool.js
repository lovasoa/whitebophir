import { MutationType } from "../js/mutation_type.js";
import { logFrontendEvent } from "../js/frontend_logging.js";

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
 * @typedef {{currentShape: any, message: any}} ShapePressEffect
 * @typedef {{update: any | null, shouldSend: boolean, nextLastTime: number, preventDefault: boolean}} ShapeMoveEffect
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
  logFrontendEvent("error", "tool.shape.draw_invalid_type", {
    toolId: config.contract.toolId,
    mutationType: data?.type,
    message: data,
  });
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @returns {ShapePressEffect}
 */
export function createShapePressEffect(state, x, y) {
  const id = state.Tools.generateUID(state.config.uidPrefix);
  const currentShape = state.config.makeCreateMessage(state, id, x, y);
  return { currentShape, message: currentShape };
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 */
export function pressShapeTool(state, x, y, evt) {
  evt.preventDefault();
  const effect = createShapePressEffect(state, x, y);
  state.currentShape = effect.currentShape;
  state.Tools.drawAndSend(effect.message, state.config.contract.toolId);
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent | undefined} evt
 * @param {boolean} force
 * @param {number} now
 * @returns {ShapeMoveEffect}
 */
export function createShapeMoveEffect(state, x, y, evt, force, now) {
  if (!state.currentShape) {
    return {
      update: null,
      shouldSend: false,
      nextLastTime: state.lastTime,
      preventDefault: true,
    };
  }
  const update = state.config.makeUpdateMessage(state, x, y, evt);
  if (!update) {
    return {
      update: null,
      shouldSend: false,
      nextLastTime: state.lastTime,
      preventDefault: false,
    };
  }
  const shouldSend = now - state.lastTime > 70 || force;
  return {
    update,
    shouldSend,
    nextLastTime: shouldSend ? now : state.lastTime,
    preventDefault: true,
  };
}

/**
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent | undefined} evt
 * @param {boolean} [force]
 */
export function moveShapeTool(state, x, y, evt, force = false) {
  const effect = createShapeMoveEffect(
    state,
    x,
    y,
    evt,
    force,
    performance.now(),
  );
  if (!effect.update) {
    if (evt && effect.preventDefault) evt.preventDefault();
    return;
  }
  const update = effect.update;
  if (effect.shouldSend) {
    state.Tools.drawAndSend(update, state.config.contract.toolId);
    state.lastTime = effect.nextLastTime;
  } else {
    drawShapeTool(state, update);
  }
  if (evt && effect.preventDefault) evt.preventDefault();
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
