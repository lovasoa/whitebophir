import { beginDrawingPerformance } from "../js/drawing_performance.js";
import { logFrontendEvent } from "../js/frontend_logging.js";
import { clampCoord, LIMITS } from "../js/message_common.js";
import { MutationType } from "../js/mutation_type.js";
import { TOOL_CODE_BY_ID } from "./tool-order.js";

/** @import { ToolBootContext, ToolRuntimeModules } from "../../types/app-runtime" */
/** @typedef {typeof import("./tool-order.js").TOOL_CODE_BY_ID} ShapeToolCodeMap */
/** @typedef {ShapeToolCodeMap["rectangle"] | ShapeToolCodeMap["ellipse"] | ShapeToolCodeMap["straight-line"]} ShapeToolCode */
/** @typedef {{config: {definition: {id: ShapeToolCode}}, preferences: ToolRuntimeModules["preferences"]}} ShapeCreateMessageState */
/** @typedef {{config: {definition: {id: ShapeToolCode}}, currentShape: {id: string, x: number, y: number} | null}} ShapeUpdateMessageState */
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
 * @typedef {Omit<NonNullable<ReturnType<typeof makeBoxShapeUpdateMessage>>, "tool"> & {tool: TTool}} ShapeBoxUpdateMessage
 */

/**
 * @template {ShapeToolCode} TTool
 * @typedef {Omit<NonNullable<ReturnType<typeof makeLineShapeUpdateMessage>>, "tool"> & {tool: TTool}} ShapeLineUpdateMessage
 */

/**
 * @typedef {ShapeCreateMessage<ShapeToolCodeMap["rectangle"]> | ShapeBoxUpdateMessage<ShapeToolCodeMap["rectangle"]> | ShapeCreateMessage<ShapeToolCodeMap["ellipse"]> | ShapeBoxUpdateMessage<ShapeToolCodeMap["ellipse"]> | ShapeCreateMessage<ShapeToolCodeMap["straight-line"]> | ShapeLineUpdateMessage<ShapeToolCodeMap["straight-line"]>} ShapeToolMessage
 */

/**
 * @typedef {{
 *   definition: Pick<import("./manifest.js").ToolManifestEntry, "toolId" | "storedTagName"> & {id: ShapeToolCode},
 *   secondary?: ShapeToolSecondary,
 *   uidPrefix: string,
 *   constrainEndPosition?: (state: ShapeToolState, x: number, y: number, evt: ShapePointerEvent) => void,
 *   makeUpdateMessage: (state: ShapeToolState, x: number, y: number, evt: ShapePointerEvent) => ShapeToolMessage | null,
 *   applyShapeGeometry: (shape: SVGElement, data: ShapeRuntimeMessage) => void,
 * }} ShapeToolConfig
 */

/** @param {ToolBootContext} ctx */
function createShapeToolStateCore(ctx) {
  const maxBoardSize = Number(ctx.runtime.config.serverConfig.MAX_BOARD_SIZE);
  return {
    board: ctx.runtime.board,
    coordinates: ctx.runtime.coordinates,
    preferences: ctx.runtime.preferences,
    writes: ctx.runtime.writes,
    maxBoardSize: Number.isFinite(maxBoardSize)
      ? maxBoardSize
      : LIMITS.DEFAULT_MAX_BOARD_SIZE,
    ids: ctx.runtime.ids,
    interaction: ctx.runtime.interaction,
    measurement: /** @type {ReturnType<typeof beginDrawingPerformance>} */ (
      null
    ),
    renderedX: 0,
    renderedY: 0,
    endX: 0,
    endY: 0,
    currentShape: /** @type {ShapeCurrentMessage | null} */ (null),
    lastTime: performance.now(),
    secondary: /** @type {ShapeToolSecondary | null} */ (null),
    lastPos: { x: 0, y: 0 },
  };
}

/**
 * @param {ShapeToolConfig} config
 * @returns {(ctx: ToolBootContext) => ShapeToolState}
 */
export function createShapeToolBoot(config) {
  return (ctx) => {
    const state = /** @type {ShapeToolState} */ ({
      ...createShapeToolStateCore(ctx),
      config,
    });
    if (config.secondary) {
      const secondary = config.secondary;
      state.secondary = { ...secondary };
      const switchSecondary = secondary.switch;
      if (switchSecondary)
        state.secondary.switch = () => switchSecondary(state);
    }
    return state;
  };
}

/**
 * @param {ShapeCreateMessageState} state
 * @param {string} id
 * @param {number} x
 * @param {number} y
 */
function makeSeedShapeCreateMessage(state, id, x, y) {
  return {
    tool: state.config.definition.id,
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

/** @param {ShapeUpdateMessageState} state @param {number} x @param {number} y */
export function makeBoxShapeUpdateMessage(state, x, y) {
  const start = state.currentShape;
  return start
    ? {
        tool: state.config.definition.id,
        type: MutationType.UPDATE,
        id: start.id,
        x: start.x,
        y: start.y,
        x2: x,
        y2: y,
      }
    : null;
}

/** @param {ShapeUpdateMessageState} state @param {number} x @param {number} y */
export function makeLineShapeUpdateMessage(state, x, y) {
  const start = state.currentShape;
  return start
    ? {
        tool: TOOL_CODE_BY_ID["straight-line"],
        type: MutationType.UPDATE,
        id: start.id,
        x2: x,
        y2: y,
      }
    : null;
}

/**
 * @param {ShapeToolState} state
 * @param {{x: number, y: number}} start
 * @param {number} x
 * @param {number} y
 */
export function constrainEqualSpanToBoard(state, start, x, y) {
  const maxBoardSize = state.maxBoardSize;
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
  state.endX = startX + xDirection * span;
  state.endY = startY + yDirection * span;
}

/**
 * @param {ShapeToolState} state
 * @param {ShapeRuntimeMessage} data
 * @returns {SVGElement}
 */
function createShape(state, data) {
  const { board, config } = state;
  const existingShape = board.svg.getElementById(data.id);
  const tagName = config.definition.storedTagName;
  if (!tagName)
    throw new Error(`Missing SVG tag for ${config.definition.toolId}`);
  const shape = /** @type {SVGElement} */ (
    existingShape?.tagName.toLowerCase() === config.definition.storedTagName
      ? existingShape
      : board.createSVGElement(tagName)
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
 * @param {boolean} [isLocal]
 */
export function drawShapeTool(state, data, isLocal = false) {
  const { board, config } = state;
  state.interaction.drawingEvent = true;
  if (data.type === MutationType.CREATE) {
    createShape(state, data);
    return;
  }
  if (data.type === MutationType.UPDATE) {
    const existingShape = board.svg.getElementById(data.id);
    const shape = /** @type {SVGElement} */ (
      existingShape?.tagName.toLowerCase() === config.definition.storedTagName
        ? existingShape
        : createShape(state, {
            id: data.id,
            x: data.x2,
            y: data.y2,
            x2: data.x2,
            y2: data.y2,
          })
    );
    config.applyShapeGeometry(shape, data);
    if (
      isLocal &&
      state.measurement &&
      data.id === state.currentShape?.id &&
      (data.x2 !== state.renderedX || data.y2 !== state.renderedY)
    ) {
      state.renderedX = data.x2;
      state.renderedY = data.y2;
      state.measurement?.accept();
      state.measurement?.geometry();
    }
    return;
  }
  logFrontendEvent("error", "tool.shape.draw_invalid_type", {
    toolId: config.definition.toolId,
    message: data,
  });
}

/**
 * @param {ShapeToolState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent} evt
 */
export function pressShapeTool(state, x, y, evt) {
  evt.preventDefault();
  state.measurement?.finish("replaced", true);
  state.renderedX = state.endX = x;
  state.renderedY = state.endY = y;
  state.measurement = beginDrawingPerformance(
    state.config.definition.toolId,
    evt,
    x,
    y,
    (pageX, pageY, time, received) => {
      observeShapeInput(
        state,
        state.coordinates.pageCoordinateToBoard(pageX),
        state.coordinates.pageCoordinateToBoard(pageY),
        undefined,
        time,
        received,
      );
    },
  );
  const id = state.ids.generateUID(state.config.uidPrefix);
  state.lastPos = { x, y };
  const message = makeSeedShapeCreateMessage(state, id, x, y);
  state.currentShape = message;
  state.writes.drawAndSend(message);
}

/**
 * @param {ShapeToolState} state
 * @param {number} x
 * @param {number} y
 * @param {MouseEvent | TouchEvent | undefined} evt
 * @param {boolean} [force]
 */
export function moveShapeTool(state, x, y, evt, force = false) {
  if (!state.currentShape) {
    evt?.preventDefault();
    return;
  }
  const now = performance.now();
  constrainEndPosition(state, x, y, evt);
  const update = state.config.makeUpdateMessage(
    state,
    state.endX,
    state.endY,
    evt,
  );
  if (!update) return;
  state.measurement?.input(state.endX, state.endY, evt?.timeStamp ?? now, now);
  if (now - state.lastTime > 70 || force) {
    state.writes.drawAndSend(update);
    state.lastTime = now;
  } else {
    drawShapeTool(state, update, true);
  }
  evt?.preventDefault();
}

/**
 * @param {ShapeToolState} state
 * @param {number} x
 * @param {number} y
 */
export function releaseShapeTool(state, x, y) {
  moveShapeTool(state, x, y, undefined, true);
  state.measurement?.finish("release");
  state.measurement = null;
  state.currentShape = null;
}

/** @param {string} shapeId */
function createDeleteShapeMessage(shapeId) {
  return {
    tool: TOOL_CODE_BY_ID.eraser,
    type: MutationType.DELETE,
    id: shapeId,
  };
}

/** @param {ShapeToolState} state */
export function cancelShapeToolTouchGesture(state) {
  finishShapePerformance(state, "cancel");
  const shapeId = state.currentShape?.id;
  state.currentShape = null;
  if (!shapeId) return;
  const shape = state.board.svg.getElementById(shapeId);
  if (shape?.parentNode === state.board.drawingArea) {
    state.board.drawingArea.removeChild(shape);
  }
  state.writes.send(createDeleteShapeMessage(shapeId));
}

/** @param {ShapeToolState} state @param {number} x @param {number} y @param {ShapePointerEvent} evt */
function constrainEndPosition(state, x, y, evt) {
  state.endX = x;
  state.endY = y;
  state.config.constrainEndPosition?.(state, x, y, evt);
}

/** @param {ShapeToolState} state @param {number} x @param {number} y @param {ShapePointerEvent} evt @param {number} time @param {number} received */
function observeShapeInput(state, x, y, evt, time, received) {
  constrainEndPosition(state, x, y, evt);
  state.measurement?.input(state.endX, state.endY, time, received);
}

/** @param {ShapeToolState} state @param {string} reason */
function finishShapePerformance(state, reason) {
  state.measurement?.finish(reason, true);
  state.measurement = null;
}
/** @param {ShapeToolState} state */
export function quitShapeTool(state) {
  finishShapePerformance(state, "tool-change");
}
/** @param {ShapeToolState} state */
export function disconnectShapeTool(state) {
  finishShapePerformance(state, "disconnect");
}
/** @param {ShapeToolState} state @param {{id?: string, parent?: string}} message */
export function rejectShapeMutation(state, message) {
  if (message.id === state.currentShape?.id)
    finishShapePerformance(state, "rejected");
}
/** @param {ShapeToolState} state @param {{type?: number, id?: string, _children?: {type?: number, id?: string}[]}} message */
export function shapeToolMessage(state, message) {
  if (message.type === MutationType.CLEAR)
    finishShapePerformance(state, "clear");
  if (
    message.type === MutationType.DELETE &&
    message.id === state.currentShape?.id
  )
    finishShapePerformance(state, "delete");
  for (const child of message._children ?? []) {
    if (
      child.type === MutationType.DELETE &&
      child.id === state.currentShape?.id
    )
      finishShapePerformance(state, "delete");
  }
}
