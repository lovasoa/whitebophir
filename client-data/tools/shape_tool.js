import { MutationType } from "../js/mutation_type.js";
import { logFrontendEvent } from "../js/frontend_logging.js";
import { clampCoord, LIMITS } from "../js/message_common.js";

/** @import { ToolBootContext, ToolRuntimeModules } from "../../types/app-runtime" */
/** @typedef {typeof import("./tool-order.js").TOOL_CODE_BY_ID} ShapeToolCodeMap */
/** @typedef {ShapeToolCodeMap["rectangle"] | ShapeToolCodeMap["ellipse"] | ShapeToolCodeMap["straight-line"]} ShapeToolCode */
/** @typedef {{config: {contract: {toolCode: ShapeToolCode}}, preferences: ToolRuntimeModules["preferences"]}} ShapeCreateMessageState */
/** @typedef {MouseEvent | TouchEvent | undefined} ShapePointerEvent */
/** @typedef {{name: string, icon: string, active: boolean, switch?: (state: ShapeToolState) => void}} ShapeToolSecondary */
/** @typedef {{tool?: ShapeToolCode, type?: number, id: string, x?: number, y?: number, x2: number, y2: number, color?: string, size?: number, opacity?: number}} ShapeRuntimeMessage */
/** @typedef {Extract<ShapeToolMessage, {type: typeof MutationType.CREATE}> & {x: number, y: number, x2: number, y2: number}} ShapeCurrentMessage */
/** @typedef {ReturnType<typeof createShapeToolStateCore> & {config: ShapeToolConfig}} ShapeToolState */

/**
 * @template {ShapeToolCode} TTool
 * @typedef {Omit<ReturnType<typeof makeSeedShapeCreateMessage>, "tool" | "opacity"> & {tool: TTool, opacity?: number}} ShapeCreateMessage
 */

/**
 * @template {ShapeToolCode} TTool
 * @typedef {Omit<ReturnType<typeof makeBoxShapeUpdateMessage>, "tool"> & {tool: TTool}} ShapeBoxUpdateMessage
 */

/**
 * @template {ShapeToolCode} TTool
 * @typedef {Omit<ReturnType<typeof makeLineShapeUpdateMessage>, "tool"> & {tool: TTool}} ShapeLineUpdateMessage
 */

/**
 * @typedef {ShapeCreateMessage<ShapeToolCodeMap["rectangle"]> | ShapeBoxUpdateMessage<ShapeToolCodeMap["rectangle"]> | ShapeCreateMessage<ShapeToolCodeMap["ellipse"]> | ShapeBoxUpdateMessage<ShapeToolCodeMap["ellipse"]> | ShapeCreateMessage<ShapeToolCodeMap["straight-line"]> | ShapeLineUpdateMessage<ShapeToolCodeMap["straight-line"]>} ShapeToolMessage
 */

/**
 * @typedef {{
 *   contract: import("./shape_contract.js").ToolContract & {storedTagName: string, toolCode: ShapeToolCode},
 *   secondary?: ShapeToolSecondary,
 *   uidPrefix: string,
 *   isShapeElement: (element: Element | null) => boolean,
 *   makeCreateMessage: (state: ShapeToolState, id: string, x: number, y: number) => ShapeCurrentMessage,
 *   makeUpdateMessage: (state: ShapeToolState, x: number, y: number, evt: ShapePointerEvent) => ShapeToolMessage | null,
 *   makeFallbackShape: (update: ShapeToolMessage) => ShapeRuntimeMessage,
 *   applyShapeGeometry: (shape: SVGElement, data: ShapeRuntimeMessage) => void,
 * }} ShapeToolConfig
 */

/**
 * @typedef {{currentShape: ShapeCurrentMessage, message: ShapeCurrentMessage}} ShapePressEffect
 */

/**
 * @typedef {{update: ShapeToolMessage | null, shouldSend: boolean, nextLastTime: number, preventDefault: boolean}} ShapeMoveEffect
 */

/** @param {ToolBootContext} ctx */
function createShapeToolStateCore(ctx) {
  return {
    board: ctx.runtime.board,
    coordinates: ctx.runtime.coordinates,
    preferences: ctx.runtime.preferences,
    writes: ctx.runtime.writes,
    runtimeConfig: ctx.runtime.config,
    ids: ctx.runtime.ids,
    interaction: ctx.runtime.interaction,
    currentShape: /** @type {ShapeCurrentMessage | null} */ (null),
    lastTime: performance.now(),
    secondary: /** @type {ShapeToolSecondary | null} */ (null),
    lastPos: { x: 0, y: 0 },
  };
}

/**
 * @param {ShapeToolConfig} config
 * @param {ToolBootContext} ctx
 */
export function bootShapeTool(config, ctx) {
  const state = /** @type {ShapeToolState} */ ({
    ...createShapeToolStateCore(ctx),
    config,
  });
  if (config.secondary) {
    const secondary = config.secondary;
    state.secondary = { ...secondary };
    const switchSecondary = secondary.switch;
    if (switchSecondary) {
      state.secondary.switch = () => switchSecondary(state);
    }
  }
  return state;
}

/**
 * @param {ShapeToolConfig} config
 * @returns {(ctx: ToolBootContext) => ShapeToolState}
 */
export function createShapeToolBoot(config) {
  return (ctx) => bootShapeTool(config, ctx);
}

/**
 * @param {ShapeCreateMessageState} state
 * @param {string} id
 * @param {number} x
 * @param {number} y
 */
export function makeSeedShapeCreateMessage(state, id, x, y) {
  return {
    tool: state.config.contract.toolCode,
    type: MutationType.CREATE,
    id,
    color: state.preferences.getColor(),
    size: state.preferences.getSize(),
    opacity: state.preferences.getOpacity(),
    x,
    y,
    x2: x,
    y2: y,
  };
}

/**
 * @template {ShapeToolCode} TTool
 * @param {TTool} tool
 * @param {string} id
 * @param {{x: number, y: number}} start
 * @param {number} x
 * @param {number} y
 */
export function makeBoxShapeUpdateMessage(tool, id, start, x, y) {
  return {
    tool,
    type: MutationType.UPDATE,
    id,
    x: start.x,
    y: start.y,
    x2: x,
    y2: y,
  };
}

/**
 * @template {ShapeToolCode} TTool
 * @param {TTool} tool
 * @param {string} id
 * @param {number} x
 * @param {number} y
 */
export function makeLineShapeUpdateMessage(tool, id, x, y) {
  return {
    tool,
    type: MutationType.UPDATE,
    id,
    x2: x,
    y2: y,
  };
}

/**
 * @param {ShapeToolState} state
 * @param {{x: number, y: number}} start
 * @param {number} x
 * @param {number} y
 * @returns {{x: number, y: number}}
 */
export function constrainEqualSpanToBoard(state, start, x, y) {
  const configuredMaxBoardSize = Number(
    state.runtimeConfig.serverConfig?.MAX_BOARD_SIZE,
  );
  const maxBoardSize = Number.isFinite(configuredMaxBoardSize)
    ? configuredMaxBoardSize
    : LIMITS.DEFAULT_MAX_BOARD_SIZE;
  const startX = clampCoord(start.x, maxBoardSize);
  const startY = clampCoord(start.y, maxBoardSize);
  const dx = x - startX;
  const dy = y - startY;
  const xDirection = dx > 0 ? 1 : -1;
  const yDirection = dy > 0 ? 1 : -1;
  const maxXSpan = xDirection > 0 ? maxBoardSize - startX : startX;
  const maxYSpan = yDirection > 0 ? maxBoardSize - startY : startY;
  const span = Math.max(
    0,
    Math.min(Math.max(Math.abs(dx), Math.abs(dy)), maxXSpan, maxYSpan),
  );
  return {
    x: startX + xDirection * span,
    y: startY + yDirection * span,
  };
}

/**
 * @param {ShapeToolState} state
 * @param {ShapeRuntimeMessage} data
 * @returns {SVGElement}
 */
function createShape(state, data) {
  const { board, config } = state;
  const existingShape = board.svg.getElementById(data.id);
  const shape = /** @type {SVGElement} */ (
    config.isShapeElement(existingShape)
      ? existingShape
      : board.createSVGElement(config.contract.storedTagName)
  );
  shape.id = data.id;
  config.applyShapeGeometry(shape, data);
  shape.setAttribute("stroke", data.color || "black");
  shape.setAttribute("stroke-width", String(data.size || 10));
  shape.setAttribute(
    "opacity",
    String(Math.max(0.1, Math.min(1, data.opacity || 1))),
  );
  if (shape.parentNode !== board.drawingArea) {
    board.drawingArea.appendChild(shape);
  }
  return shape;
}

/**
 * @param {ShapeToolState} state
 * @param {ShapeToolMessage} data
 */
export function drawShapeTool(state, data) {
  const { board, config } = state;
  state.interaction.drawingEvent = true;
  if (data.type === MutationType.CREATE) {
    createShape(state, data);
    return;
  }
  if (data.type === MutationType.UPDATE) {
    const existingShape = board.svg.getElementById(data.id);
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
    message: data,
  });
}

/**
 * @param {ShapeToolState} state
 * @param {number} x
 * @param {number} y
 * @returns {ShapePressEffect}
 */
export function createShapePressEffect(state, x, y) {
  const id = state.ids.generateUID(state.config.uidPrefix);
  const currentShape = state.config.makeCreateMessage(state, id, x, y);
  return { currentShape, message: currentShape };
}

/**
 * @param {ShapeToolState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 */
export function pressShapeTool(state, x, y, evt) {
  evt.preventDefault();
  const effect = createShapePressEffect(state, x, y);
  state.currentShape = effect.currentShape;
  state.writes.drawAndSend(effect.message);
}

/**
 * @param {ShapeToolState} state
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
 * @param {ShapeToolState} state
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
    state.writes.drawAndSend(update);
    state.lastTime = effect.nextLastTime;
  } else {
    drawShapeTool(state, update);
  }
  if (evt && effect.preventDefault) evt.preventDefault();
}

/**
 * @param {ShapeToolState} state
 * @param {number} x
 * @param {number} y
 */
export function releaseShapeTool(state, x, y) {
  moveShapeTool(state, x, y, undefined, true);
  state.currentShape = null;
}
