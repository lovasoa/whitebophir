import { getToolRuntimeAssetPath } from "../tools/tool-defaults.js";
import { DEFAULT_BOARD_SCALE } from "./board_viewport.js";
import MessageCommon from "./message_common.js";
import RateLimitCommon from "./rate_limit_common.js";

/** @import { AppInitialPreferences, ColorPreset, ConfiguredRateLimitDefinition, LiveBoardMessage, RateLimitKind, ServerConfig } from "../../types/app-runtime" */

const RATE_LIMIT_KINDS = /** @type {RateLimitKind[]} */ (
  RateLimitCommon.RATE_LIMIT_KINDS
);

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
    const key = s.toLowerCase().replace(/ /g, "_");
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
    return MessageCommon.clampCoord(
      value,
      state.config.serverConfig.MAX_BOARD_SIZE,
    );
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

/**
 * @param {string} assetPath
 * @returns {string}
 */
export function normalizeBoardAssetPath(assetPath) {
  if (
    assetPath.startsWith("./") ||
    assetPath.startsWith("../") ||
    assetPath.startsWith("/") ||
    assetPath.startsWith("data:") ||
    assetPath.startsWith("http://") ||
    assetPath.startsWith("https://")
  ) {
    return assetPath;
  }
  return `../${assetPath}`;
}

export class AssetModule {
  /** @param {(assetPath: string) => string} resolveAssetPath */
  constructor(resolveAssetPath) {
    this.resolveAssetPath = resolveAssetPath;
  }

  /**
   * @param {string} toolName
   * @param {string} assetFile
   */
  getToolAssetUrl(toolName, assetFile) {
    return this.resolveAssetPath(getToolRuntimeAssetPath(toolName, assetFile));
  }
}

const rateLimitModuleState = new WeakMap();

export class RateLimitModule {
  /**
   * @param {ConfigModule} config
   * @param {IdentityModule} identity
   */
  constructor(config, identity) {
    rateLimitModuleState.set(this, { config, identity });
  }

  /** @param {RateLimitKind} kind */
  getRateLimitDefinition(kind) {
    const state =
      /** @type {{config: ConfigModule, identity: IdentityModule}} */ (
        rateLimitModuleState.get(this)
      );
    const configured = state.config.serverConfig.RATE_LIMITS || {};
    if (configured && configured[kind]) return configured[kind];

    return {
      limit: 0,
      anonymousLimit: 0,
      periodMs: 0,
    };
  }

  /** @param {RateLimitKind} kind */
  getEffectiveRateLimit(kind) {
    const state =
      /** @type {{config: ConfigModule, identity: IdentityModule}} */ (
        rateLimitModuleState.get(this)
      );
    return RateLimitCommon.getEffectiveRateLimitDefinition(
      this.getRateLimitDefinition(kind),
      state.identity.boardName,
    );
  }

  /** @param {LiveBoardMessage} message */
  getBufferedWriteCosts(message) {
    return RATE_LIMIT_KINDS.reduce(
      (costs, kind) => {
        costs[kind] = RateLimitCommon.getRateLimitCost(kind, message);
        return costs;
      },
      /** @type {import("../../types/app-runtime").RateLimitCosts} */ ({}),
    );
  }
}

export class ViewportStateModule {
  /** @param {import("../../types/app-runtime").ViewportController} controller */
  constructor(controller) {
    this.scale = DEFAULT_BOARD_SCALE;
    this.controller = controller;
    this.drawToolsAllowed = /** @type {boolean | null} */ (null);
  }
}

export class InteractionModule {
  constructor() {
    this.drawingEvent = true;
    this.showMarker = true;
    this.showOtherCursors = true;
    this.showMyCursor = true;
  }
}

export class IdModule {
  /**
   * @param {string} [prefix]
   * @param {string} [suffix]
   */
  generateUID(prefix, suffix) {
    let uid = Date.now().toString(36);
    uid += Math.round(Math.random() * 36).toString(36);
    if (prefix) uid = prefix + uid;
    if (suffix) uid = uid + suffix;
    return uid;
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
    this.currentSize = MessageCommon.clampSize(initial.size);
    this.currentOpacity = MessageCommon.clampOpacity(initial.opacity);
    this.initial = initial;
    this.colorChangeHandlers = /** @type {((color: string) => void)[]} */ ([]);
    this.sizeChangeHandlers = /** @type {((size: number) => void)[]} */ ([]);
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

  /** @param {number | string | null | undefined} value */
  setSize(value) {
    if (value !== null && value !== undefined) {
      this.currentSize = MessageCommon.clampSize(value);
    }
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
}
