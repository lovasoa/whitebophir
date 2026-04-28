import { initializeCoreRuntime } from "./app_tools_core.js";
import { attachBoardDomToRuntime } from "./board_dom_bootstrap.js";
import { parseEmbeddedJson, resolveBoardName } from "./board_page_state.js";
import {
  createInitialPreferences,
  DEFAULT_COLOR_PRESETS,
} from "./board_preferences.js";

/** @import { AppToolsState, ServerConfig } from "../../types/app-runtime" */

/**
 * @returns {AppToolsState}
 */
export function createBoardRuntimeShellFromPage() {
  const colorPresets = DEFAULT_COLOR_PRESETS;
  const tools = /** @type {AppToolsState} */ (
    /** @type {unknown} */ (
      initializeCoreRuntime(
        {},
        {
          translations: /** @type {{[key: string]: string}} */ (
            parseEmbeddedJson("translations", {})
          ),
          serverConfig: /** @type {ServerConfig} */ (
            parseEmbeddedJson("configuration", {})
          ),
          boardName: resolveBoardName(window.location.pathname),
          token: new URL(window.location.href).searchParams.get("token"),
          colorPresets,
          initialPreferences: createInitialPreferences(colorPresets),
        },
      )
    )
  );
  window.WBOApp = tools;
  return tools;
}

/**
 * @param {AppToolsState} tools
 * @param {Document} document
 * @returns {Promise<() => void>}
 */
export async function attachPanReadyRuntime(tools, document) {
  const baseline = await attachBoardDomToRuntime(tools, document);
  tools.initialAuthoritativeSeq = baseline.authoritativeSeq;
  tools.viewportState.install();
  tools.viewportState.controller.setTouchPolicy("native-pan");
  tools.viewportState.restoreFromHash();
  return tools.viewportState.controller.installTemporaryPan();
}
