import { DEFAULT_BOARD_SCALE } from "./board_viewport.js";
import { clampCoord, clampOpacity, clampSize } from "./message_limits.js";

/** @import { AppInitialPreferences, ColorPreset, ServerConfig } from "../../types/app-runtime" */

/** @typedef {{status: "attached", svg: SVGSVGElement, drawingArea: SVGGElement}} AttachedBoardDomRuntimeThis */
/** @typedef {{status: "detached"} | AttachedBoardDomRuntimeThis} BoardDomRuntimeThis */

/** @param {BoardDomRuntimeActions} actions */
function getBoardDomRuntimeThis(actions) {
  return /** @type {BoardDomRuntimeThis} */ (/** @type {unknown} */ (actions));
}

export class BoardDomRuntimeActions {
  /**
   * @param {string} name
   * @param {{[key: string]: string | number | undefined}} [attrs]
   */
  createSVGElement(name, attrs) {
    const dom = getBoardDomRuntimeThis(this);
    if (dom.status !== "attached") {
      throw new Error("Board SVG is not attached.");
    }
    const elem = /** @type {SVGElement} */ (
      /** @type {unknown} */ (
        document.createElementNS(dom.svg.namespaceURI, name)
      )
    );
    if (!attrs) return elem;
    Object.keys(attrs).forEach((key) => {
      elem.setAttributeNS(null, key, String(attrs[key]));
    });
    return elem;
  }

  /**
   * @param {HTMLElement} elem
   * @param {number} x
   * @param {number} y
   */
  positionElement(elem, x, y) {
    elem.style.top = `${y}px`;
    elem.style.left = `${x}px`;
  }

  clearBoardCursors() {
    const dom = getBoardDomRuntimeThis(this);
    if (dom.status !== "attached") return;
    const cursors = dom.svg.getElementById("cursors");
    if (cursors) cursors.innerHTML = "";
  }

  resetBoardViewport() {
    const dom = getBoardDomRuntimeThis(this);
    if (dom.status !== "attached") return;
    dom.drawingArea.innerHTML = "";
    this.clearBoardCursors();
  }
}

export class DetachedBoardDomRuntimeModule extends BoardDomRuntimeActions {
  constructor() {
    super();
    this.status = /** @type {"detached"} */ ("detached");
  }
}

export class AttachedBoardDomRuntimeModule extends BoardDomRuntimeActions {
  /**
   * @param {HTMLElement} board
   * @param {SVGSVGElement} svg
   * @param {SVGGElement} drawingArea
   */
  constructor(board, svg, drawingArea) {
    super();
    this.status = /** @type {"attached"} */ ("attached");
    this.board = board;
    this.svg = svg;
    this.drawingArea = drawingArea;
  }
}

const i18nModuleTranslations = new WeakMap();

export class I18nModule {
  /** @param {{[key: string]: string}} translations */
  constructor(translations) {
    i18nModuleTranslations.set(this, translations);
  }

  /** @param {string} s */
  t(s) {
    const key = s.toLowerCase().replace(/[ -]/g, "_");
    return (
      /** @type {{[key: string]: string}} */ (i18nModuleTranslations.get(this))[
        key
      ] || s
    );
  }
}

export class ConfigModule {
  /** @param {ServerConfig} serverConfig */
  constructor(serverConfig) {
    this.serverConfig = serverConfig;
  }
}

export class IdentityModule {
  /**
   * @param {string} boardName
   * @param {string | null} token
   */
  constructor(boardName, token) {
    this.boardName = boardName;
    this.token = token;
  }
}

const coordinateModuleState = new WeakMap();

export class CoordinateModule {
  /**
   * @param {ConfigModule} config
   * @param {ViewportStateModule} viewportState
   */
  constructor(config, viewportState) {
    coordinateModuleState.set(this, { config, viewportState });
  }

  /** @param {unknown} value */
  toBoardCoordinate(value) {
    const state =
      /** @type {{config: ConfigModule, viewportState: ViewportStateModule}} */ (
        coordinateModuleState.get(this)
      );
    return clampCoord(value, state.config.serverConfig.MAX_BOARD_SIZE);
  }

  /** @param {unknown} value */
  pageCoordinateToBoard(value) {
    const state =
      /** @type {{config: ConfigModule, viewportState: ViewportStateModule}} */ (
        coordinateModuleState.get(this)
      );
    return state.viewportState.controller.pageCoordinateToBoard(value);
  }
}

export class ViewportStateModule {
  /** @param {import("../../types/app-runtime").ViewportController} controller */
  constructor(controller) {
    this.scale = DEFAULT_BOARD_SCALE;
    this.controller = controller;
    this.drawToolsAllowed = /** @type {boolean | null} */ (null);
  }

  install() {
    this.controller.install();
  }

  restoreFromHash() {
    this.controller.installHashObservers();
    this.controller.applyFromHash();
  }
}

export class PreferenceModule {
  /**
   * @param {ColorPreset[]} presets
   * @param {AppInitialPreferences} initial
   */
  constructor(presets, initial) {
    this.colorPresets = presets;
    this.colorChooser = /** @type {HTMLInputElement | null} */ (null);
    this.colorButtonsInitialized = false;
    this.currentColor = initial.color;
    /** @type number */
    this.currentSize = clampSize(initial.size);
    /** @type number */
    this.currentOpacity = clampOpacity(initial.opacity);
    /** @type AppInitialPreferences */
    this.initial = initial;
    /** @type {((color: string) => void)[]} */
    this.colorChangeHandlers = [];
    /** @type {((size: number) => void)[]} */
    this.sizeChangeHandlers = [];
    this.opacityChangeHandlers =
      /** @type {((opacity: number) => void)[]} */ ([]);
  }

  getColor() {
    return this.currentColor;
  }

  /** @param {string} color */
  setColor(color) {
    this.currentColor = color;
    if (this.colorChooser) {
      this.colorChooser.value = color;
    }
    this.colorChangeHandlers.forEach((handler) => {
      handler(color);
    });
  }

  getSize() {
    return this.currentSize;
  }

  /** @param {number} value */
  setSize(value) {
    this.currentSize = clampSize(value);
    const chooser = document.getElementById("chooseSize");
    if (chooser instanceof HTMLInputElement) {
      chooser.value = String(this.currentSize);
    }
    this.sizeChangeHandlers.forEach((handler) => {
      handler(this.currentSize);
    });
    return this.currentSize;
  }

  getOpacity() {
    return this.currentOpacity;
  }

  /** @param {number} value */
  setOpacity(value) {
    this.currentOpacity = clampOpacity(value);
    const chooser = document.getElementById("chooseOpacity");
    if (chooser instanceof HTMLInputElement) {
      chooser.value = String(this.currentOpacity);
    }
    this.opacityChangeHandlers.forEach((handler) => {
      handler(this.currentOpacity);
    });
    return this.currentOpacity;
  }
}
