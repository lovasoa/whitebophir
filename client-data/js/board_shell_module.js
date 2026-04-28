import { updateDocumentTitle } from "./board_message_module.js";
import {
  getRequiredElement,
  normalizeBoardState,
  parseEmbeddedJson,
  updateRecentBoards,
} from "./board_page_state.js";
import { addToolShortcut } from "./board_tool_registry_module.js";
import MessageCommon from "./message_common.js";

/** @import { AppInitialPreferences, AppToolsState, ColorPreset } from "../../types/app-runtime" */

const DEFAULT_INITIAL_SIZE = 40;
const DEFAULT_INITIAL_OPACITY = 1;

export const DEFAULT_COLOR_PRESETS = [
  { color: "#001f3f", key: "1" },
  { color: "#FF4136", key: "2" },
  { color: "#0074D9", key: "3" },
  { color: "#FF851B", key: "4" },
  { color: "#FFDC00", key: "5" },
  { color: "#3D9970", key: "6" },
  { color: "#91E99B", key: "7" },
  { color: "#90468b", key: "8" },
  { color: "#7FDBFF", key: "9" },
  { color: "#AAAAAA", key: "0" },
  { color: "#E65194" },
];

/**
 * @param {ColorPreset[]} colorPresets
 * @returns {AppInitialPreferences}
 */
export function createInitialPreferences(colorPresets = DEFAULT_COLOR_PRESETS) {
  const colorIndex = (Math.random() * colorPresets.length) | 0;
  const initialPreset = colorPresets[colorIndex] || colorPresets[0];
  return {
    tool: "hand",
    color: initialPreset?.color || "#001f3f",
    size: DEFAULT_INITIAL_SIZE,
    opacity: DEFAULT_INITIAL_OPACITY,
  };
}

/**
 * @param {string} elementId
 * @returns {HTMLInputElement}
 */
function getRequiredInput(elementId) {
  return /** @type {HTMLInputElement} */ (getRequiredElement(elementId));
}

export class BoardShellModule {
  /**
   * @param {() => AppToolsState} getTools
   * @param {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} logBoardEvent
   */
  constructor(getTools, logBoardEvent) {
    this.getTools = getTools;
    this.logBoardEvent = logBoardEvent;
  }

  initializePageChrome() {
    document.documentElement.dataset.activeToolSecondary = "false";
    this.trackRecentBoardsOnPageShow();
    this.bindRenderedTools();
    this.applyInitialBoardState();
    this.bindPresencePanel();
    this.bindPreferenceControls();
    this.bindPageLifecycleEvents();
    this.bindMenuDrag();
  }

  trackRecentBoardsOnPageShow() {
    window.addEventListener("pageshow", () => {
      this.saveBoardNameToLocalStorage();
    });
  }

  saveBoardNameToLocalStorage() {
    const Tools = this.getTools();
    const boardName = Tools.identity.boardName;
    const key = "recent-boards";
    let recentBoards;
    try {
      const storedBoards = localStorage.getItem(key);
      recentBoards = storedBoards ? JSON.parse(storedBoards) : [];
    } catch (e) {
      recentBoards = [];
      this.logBoardEvent("warn", "boot.recent_boards_load_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    recentBoards = updateRecentBoards(recentBoards, boardName);
    localStorage.setItem(key, JSON.stringify(recentBoards));
  }

  bindRenderedTools() {
    this.getTools().toolRegistry.bindRenderedToolButtons();
  }

  applyInitialBoardState() {
    this.getTools().access.applyBoardState(
      normalizeBoardState(
        parseEmbeddedJson("board-state", {
          readonly: false,
          canWrite: true,
        }),
      ),
    );
  }

  bindPresencePanel() {
    this.getTools().presence.initConnectedUsersUI();
  }

  bindPreferenceControls() {
    const Tools = this.getTools();
    const colorChooser = getRequiredInput("chooseColor");
    const sizeChooser = getRequiredInput("chooseSize");
    const opacityChooser = getRequiredInput("chooseOpacity");
    const opacityIndicator = getRequiredElement("opacityIndicator");
    const opacityIndicatorFill =
      document.getElementById("opacityIndicatorFill") || opacityIndicator;

    Tools.preferences.colorChooser = colorChooser;
    colorChooser.value = Tools.preferences.currentColor;
    colorChooser.onchange = colorChooser.oninput = () => {
      Tools.preferences.setColor(colorChooser.value);
    };

    sizeChooser.value = String(Tools.preferences.currentSize);
    sizeChooser.onchange = sizeChooser.oninput = () => {
      Tools.preferences.setSize(sizeChooser.value);
    };

    const updateOpacity = () => {
      Tools.preferences.currentOpacity = MessageCommon.clampOpacity(
        opacityChooser.value,
      );
      opacityChooser.value = String(Tools.preferences.currentOpacity);
      opacityIndicatorFill.setAttribute(
        "opacity",
        String(Tools.preferences.currentOpacity),
      );
    };
    Tools.preferences.colorChangeHandlers.push(
      /** @param {string} color */ (color) => {
        opacityIndicatorFill.setAttribute("fill", color);
      },
    );
    opacityChooser.value = String(Tools.preferences.currentOpacity);
    updateOpacity();
    opacityChooser.onchange = opacityChooser.oninput = updateOpacity;

    if (!Tools.preferences.colorButtonsInitialized) {
      Tools.preferences.colorButtonsInitialized = true;
      this.addColorButtons();
    }
    Tools.preferences.setColor(Tools.preferences.currentColor);
    Tools.preferences.setSize(Tools.preferences.currentSize);
  }

  addColorButtons() {
    const colorPresetContainer = getRequiredElement("colorPresetSel");
    const colorPresetTemplateElement =
      colorPresetContainer.querySelector(".colorPresetButton");
    if (!(colorPresetTemplateElement instanceof HTMLElement)) {
      throw new Error("Missing required color preset template");
    }
    const colorPresetTemplate = colorPresetTemplateElement;
    colorPresetTemplate.remove();

    this.getTools().preferences.colorPresets.forEach((button) => {
      this.addColorButton(colorPresetContainer, colorPresetTemplate, button);
    });
  }

  /**
   * @param {HTMLElement} colorPresetContainer
   * @param {HTMLElement} colorPresetTemplate
   * @param {ColorPreset} button
   * @returns {HTMLElement}
   */
  addColorButton(colorPresetContainer, colorPresetTemplate, button) {
    const Tools = this.getTools();
    const setColor = () => Tools.preferences.setColor(button.color);
    if (button.key) addToolShortcut(button.key, setColor);
    const elem = colorPresetTemplate.cloneNode(true);
    if (!(elem instanceof HTMLElement)) {
      throw new Error("Color preset template clone must be an element");
    }
    elem.addEventListener("click", setColor);
    elem.id = `color_${button.color.replace(/^#/, "")}`;
    elem.style.backgroundColor = button.color;
    if (button.key) {
      elem.title = `${Tools.i18n.t("keyboard shortcut")}: ${button.key}`;
    }
    colorPresetContainer.appendChild(elem);
    return elem;
  }

  bindPageLifecycleEvents() {
    window.addEventListener("focus", () => {
      const Tools = this.getTools();
      Tools.messages.unreadCount = 0;
      updateDocumentTitle(Tools.messages, Tools.identity);
      if (Tools.writes.bufferedWrites.length > 0) {
        Tools.writes.flushBufferedWrites();
      }
    });

    document.addEventListener("visibilitychange", () => {
      const Tools = this.getTools();
      if (!document.hidden && Tools.writes.bufferedWrites.length > 0) {
        Tools.writes.flushBufferedWrites();
      }
    });
  }

  bindMenuDrag() {
    let pos = { top: 0, scroll: 0 };
    const menu = getRequiredElement("menu");
    /** @param {MouseEvent} evt */
    function menu_mousedown(evt) {
      pos = {
        top: menu.scrollTop,
        scroll: evt.clientY,
      };
      menu.addEventListener("mousemove", menu_mousemove);
      document.addEventListener("mouseup", menu_mouseup);
    }
    /** @param {MouseEvent} evt */
    function menu_mousemove(evt) {
      const dy = evt.clientY - pos.scroll;
      menu.scrollTop = pos.top - dy;
    }
    function menu_mouseup() {
      menu.removeEventListener("mousemove", menu_mousemove);
      document.removeEventListener("mouseup", menu_mouseup);
    }
    menu.addEventListener("mousedown", menu_mousedown);
  }
}
