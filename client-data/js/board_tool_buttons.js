import { getRequiredElement } from "./board_page_state.js";
import { blurActiveElement } from "./board_tool_input.js";
import { isTextEntryTarget } from "./text_entry_target.js";

/** @import { AppToolsState, MountedAppTool } from "../../types/app-runtime" */

/**
 * @param {string} toolName
 * @returns {{button: HTMLElement, primaryIcon: HTMLImageElement, secondaryIcon: HTMLImageElement | null, label: HTMLElement}}
 */
function getRequiredToolButtonParts(toolName) {
  const button = getRequiredElement(`toolID-${toolName}`);
  const primaryIcon = /** @type {HTMLImageElement | null} */ (
    button.querySelector(".tool-icon")
  );
  const label = /** @type {HTMLElement | null} */ (
    button.querySelector(".tool-name")
  );
  if (!primaryIcon || !label) {
    throw new Error(`Missing required tool button structure for ${toolName}`);
  }
  return {
    button: button,
    primaryIcon: primaryIcon,
    secondaryIcon: /** @type {HTMLImageElement | null} */ (
      button.querySelector(".secondaryIcon")
    ),
    label: label,
  };
}

/**
 * @param {AppToolsState} Tools
 * @param {HTMLElement} button
 * @param {string} toolName
 * @returns {void}
 */
function bindToolButton(Tools, button, toolName) {
  if (button.dataset.toolBound === "true") return;
  button.dataset.toolId = toolName;
  button.dataset.toolBound = "true";
  button.setAttribute("aria-label", toolName);
  button.addEventListener("click", () => {
    void Tools.toolRegistry.activateTool(toolName);
  });
  button.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      void Tools.toolRegistry.activateTool(toolName);
    }
  });
}

/**
 * @param {string} toolName
 * @returns {HTMLElement | null}
 */
export function getToolButton(toolName) {
  const button = document.getElementById(`toolID-${toolName}`);
  return button instanceof HTMLElement ? button : null;
}

/**
 * Fills `.tool-name` for a mounted tool row (label text + optional extras).
 * Do not assign `label.textContent` elsewhere: it would drop sibling nodes.
 *
 * @param {HTMLElement} label
 * @param {string} translatedName
 * @param {string | undefined} shortcut
 * @returns {void}
 */
function renderToolButtonLabel(label, translatedName, shortcut) {
  label.textContent = translatedName;
  if (shortcut) {
    const shortcutSpan = document.createElement("span");
    shortcutSpan.className = "tool-shortcut";
    shortcutSpan.textContent = shortcut.toUpperCase();
    label.appendChild(shortcutSpan);
  }
}

/**
 * @param {AppToolsState} Tools
 * @param {string} toolName
 * @param {MountedAppTool} tool
 * @returns {void}
 */
function syncToolButton(Tools, toolName, tool) {
  const button = getToolButton(toolName);
  if (!button) return;
  bindToolButton(Tools, button, toolName);
  const parts = getRequiredToolButtonParts(toolName);
  const translatedToolName = Tools.i18n.t(toolName);
  renderToolButtonLabel(parts.label, translatedToolName, tool.shortcut);
  button.setAttribute("aria-label", translatedToolName);
  parts.primaryIcon.src = Tools.assets.resolveAssetPath(tool.icon);
  parts.primaryIcon.alt = "";
  button.classList.toggle("oneTouch", tool.oneTouch === true);
  button.classList.toggle("hasSecondary", !!tool.secondary);
  parts.primaryIcon.classList.toggle("primaryIcon", !!tool.secondary);
  button.removeAttribute("title");
  if (tool.secondary && parts.secondaryIcon) {
    parts.secondaryIcon.src = Tools.assets.resolveAssetPath(
      tool.secondary.icon,
    );
    parts.secondaryIcon.alt = "";
  } else if (parts.secondaryIcon) {
    parts.secondaryIcon.src = "data:,";
    parts.secondaryIcon.alt = "";
  }
}

/** @param {AppToolsState} Tools */
export function bindRenderedToolButtons(Tools) {
  document
    .querySelectorAll("#tools > .tool[data-tool-id]")
    .forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const toolName = element.dataset.toolId;
      if (!toolName) return;
      bindToolButton(Tools, element, toolName);
    });
}

/**
 * @returns {string[]}
 */
export function getRenderedToolNames() {
  return Array.from(document.querySelectorAll("#tools > .tool[data-tool-id]"))
    .map((element) => element.getAttribute("data-tool-id") || "")
    .filter(Boolean);
}

/**
 * @param {string} key
 * @param {() => void} callback
 * @returns {void}
 */
export function addToolShortcut(key, callback) {
  window.addEventListener("keydown", (e) => {
    if (e.key === key && !isTextEntryTarget(e.target)) {
      callback();
    }
  });
}

/**
 * @param {AppToolsState} Tools
 * @param {string} toolName
 * @returns {HTMLElement | null}
 */
export function syncMountedToolButton(Tools, toolName) {
  const tool = Tools.toolRegistry.mounted[toolName];
  if (!tool) {
    throw new Error(`Tool not registered before rendering: ${toolName}`);
  }
  if (tool.shortcut) {
    addToolShortcut(tool.shortcut, () => {
      void Tools.toolRegistry.activateTool(toolName);
      blurActiveElement();
    });
  }
  syncToolButton(Tools, toolName, tool);
  Tools.toolRegistry.syncToolDisabledState(toolName);
  return getToolButton(toolName);
}

/**
 * @param {string} oldToolName
 * @param {string} newToolName
 * @returns {void}
 */
function changeActiveToolButton(oldToolName, newToolName) {
  const oldTool = document.getElementById(`toolID-${oldToolName}`);
  const newTool = document.getElementById(`toolID-${newToolName}`);
  if (oldTool) {
    oldTool.classList.remove("curTool");
    oldTool.removeAttribute("aria-current");
  }
  if (newTool) {
    newTool.classList.add("curTool");
    newTool.setAttribute("aria-current", "true");
  }
}

/**
 * @param {AppToolsState} Tools
 * @param {{ toolName: string, labelKey: string, icon: string, shortcut?: string }} params
 *   `labelKey` is the i18n id for the row label. `shortcut` is the primary key hint (same in secondary mode).
 * @returns {void}
 */
export function toggleToolButtonMode(
  Tools,
  { toolName, labelKey, icon, shortcut },
) {
  const parts = getRequiredToolButtonParts(toolName);
  const secondaryIcon = parts.secondaryIcon;
  if (!secondaryIcon) {
    throw new Error(`Missing secondary icon for tool ${toolName}`);
  }
  const primaryIconSrc = parts.primaryIcon.src;
  parts.primaryIcon.src = secondaryIcon.src;
  secondaryIcon.src = primaryIconSrc;
  parts.primaryIcon.src = Tools.assets.resolveAssetPath(icon);
  renderToolButtonLabel(parts.label, Tools.i18n.t(labelKey), shortcut);
}

/**
 * @param {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} logger
 * @param {AppToolsState} Tools
 * @param {string} toolName
 * @param {MountedAppTool} newTool
 * @returns {void}
 */
export function updateCurrentToolChrome(Tools, toolName, newTool, logger) {
  const dom = Tools.dom;
  if (dom.status !== "attached") return;
  const curToolName = Tools.toolRegistry.current
    ? Tools.toolRegistry.current.name
    : "";
  try {
    changeActiveToolButton(curToolName, toolName);
  } catch (e) {
    logger("error", "tool.chrome_update_failed", {
      toolName,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  dom.svg.style.cursor = Tools.toolRegistry.shouldDisableTool(toolName)
    ? "not-allowed"
    : newTool.mouseCursor || "auto";
  dom.board.title = Tools.i18n.t(newTool.helpText || "");
  Tools.status.syncWriteStatusIndicator();
}

/** @param {AppToolsState} Tools */
export function syncActiveToolState(Tools) {
  const currentTool = Tools.toolRegistry.current;
  if (!currentTool) {
    delete document.documentElement.dataset.activeTool;
    delete document.documentElement.dataset.activeToolMode;
    document.documentElement.dataset.activeToolSecondary = "false";
    return;
  }
  document.documentElement.dataset.activeTool = currentTool.name;
  document.documentElement.dataset.activeToolMode =
    currentTool.secondary && currentTool.secondary.active
      ? currentTool.secondary.name
      : currentTool.name;
  document.documentElement.dataset.activeToolSecondary =
    currentTool.secondary && currentTool.secondary.active ? "true" : "false";
}
