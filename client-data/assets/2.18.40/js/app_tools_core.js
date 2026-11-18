import {
  AttachedBoardDomRuntimeModule,
  CoordinateModule,
  DetachedBoardDomRuntimeModule,
  I18nModule,
  PreferenceModule,
  ViewportStateModule,
} from "./board_runtime_core.js";
import { createViewportController } from "./board_viewport.js";

/** @import { AppInitialPreferences, ColorPreset, ServerConfig } from "../../types/app-runtime" */
/** @typedef {{translations: {[key: string]: string}, serverConfig: ServerConfig, boardName: string, token: string | null, colorPresets: ColorPreset[], initialPreferences: AppInitialPreferences}} AppToolsCoreOptions */

/**
 * @param {AppToolsCoreOptions} options
 * @returns {object}
 */
export function createCoreRuntime(options) {
  const runtime = /** @type {any} */ ({
    i18n: new I18nModule(options.translations),
    config: { serverConfig: options.serverConfig },
    identity: { boardName: options.boardName, token: options.token },
    dom: new DetachedBoardDomRuntimeModule(),
    preferences: new PreferenceModule(
      options.colorPresets,
      options.initialPreferences,
    ),
    initialAuthoritativeSeq: 0,
    toolRegistry: {
      current: null,
      mounted: {},
      syncDrawToolAvailability() {},
      syncActiveToolInputPolicy() {},
    },
  });
  const viewportController = createViewportController(runtime);
  runtime.viewportState = new ViewportStateModule(viewportController);
  runtime.coordinates = new CoordinateModule(
    runtime.config,
    runtime.viewportState,
  );
  runtime.attachDom = attachDom;
  return runtime;
}

/**
 * @this {any}
 * @param {HTMLElement} board
 * @param {SVGSVGElement} svg
 * @param {SVGGElement} drawingArea
 * @returns {AttachedBoardDomRuntimeModule}
 */
function attachDom(board, svg, drawingArea) {
  const dom = new AttachedBoardDomRuntimeModule(board, svg, drawingArea);
  this.dom = dom;
  return dom;
}
