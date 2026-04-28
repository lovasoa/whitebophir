import {
  AssetModule,
  AttachedBoardDomRuntimeModule,
  ConfigModule,
  CoordinateModule,
  DetachedBoardDomRuntimeModule,
  I18nModule,
  IdentityModule,
  IdModule,
  InteractionModule,
  normalizeBoardAssetPath,
  PreferenceModule,
  RateLimitModule,
  ViewportStateModule,
} from "./board_runtime_core.js";
import { createViewportController } from "./board_viewport.js";

/** @import { AppInitialPreferences, ColorPreset, ServerConfig } from "../../types/app-runtime" */
/** @typedef {{translations: {[key: string]: string}, serverConfig: ServerConfig, boardName: string, token: string | null, colorPresets: ColorPreset[], initialPreferences: AppInitialPreferences}} AppToolsCoreOptions */

/**
 * @param {object} target
 * @param {AppToolsCoreOptions} options
 * @returns {object}
 */
export function initializeCoreRuntime(target, options) {
  Object.assign(target, {
    i18n: new I18nModule(options.translations),
    config: new ConfigModule(options.serverConfig),
    identity: new IdentityModule(options.boardName, options.token),
    assets: new AssetModule(normalizeBoardAssetPath),
    dom: new DetachedBoardDomRuntimeModule(),
    interaction: new InteractionModule(),
    ids: new IdModule(),
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
  const runtime = /** @type {any} */ (target);
  runtime.rateLimits = new RateLimitModule(runtime.config, runtime.identity);
  const viewportController = createViewportController(runtime);
  runtime.viewportState = new ViewportStateModule(viewportController);
  runtime.coordinates = new CoordinateModule(
    runtime.config,
    runtime.viewportState,
  );
  runtime.attachDom = attachDom;
  return target;
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
