import { updateDocumentTitle } from "./board_message_module.js";
import { attachBoardDomToRuntime } from "./board_dom_bootstrap.js";
import {
  DEFAULT_COLOR_PRESETS,
  createInitialPreferences,
} from "./board_preferences.js";
import {
  getRequiredElement,
  normalizeBoardState,
  parseEmbeddedJson,
  updateRecentBoards,
} from "./board_page_state.js";
import { addToolShortcut } from "./board_tool_registry_module.js";
import { isTextEntryTarget } from "./text_entry_target.js";
import { LIMITS } from "./message_limits.js";

/** @import { AppToolsState, ColorPreset } from "../../types/app-runtime" */

export { DEFAULT_COLOR_PRESETS, createInitialPreferences };

const STYLE_PREVIEW_MIN_RADIUS = 4;
const STYLE_PREVIEW_MAX_RADIUS = 15;
const SIZE_KEY_STEP_COARSE = 50;
const SIZE_KEY_STEP_FINE = 10;
const OPACITY_KEY_STEP_COARSE = 0.1;
const OPACITY_KEY_STEP_FINE = 0.05;

/** Delay before closing the style panel so the pointer can cross the gap between the rail button and the fixed panel. */
const STYLE_PANEL_CLOSE_MS = 320;

/**
 * @param {number} size
 * @returns {number}
 */
function styleSizeToPreviewRadius(size) {
  const range = LIMITS.MAX_SIZE - LIMITS.MIN_SIZE || 1;
  const fraction = (size - LIMITS.MIN_SIZE) / range;
  return (
    STYLE_PREVIEW_MIN_RADIUS +
    Math.max(0, Math.min(1, fraction)) *
      (STYLE_PREVIEW_MAX_RADIUS - STYLE_PREVIEW_MIN_RADIUS)
  );
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

  /**
   * @param {Document} document
   * @returns {Promise<void>}
   */
  async attachBoardDom(document) {
    const Tools = this.getTools();
    const baseline = await attachBoardDomToRuntime(Tools, document);
    Tools.replay.authoritativeSeq = baseline.authoritativeSeq;
    Tools.toolRegistry.normalizeServerRenderedElements();
    Tools.toolRegistry.syncActiveToolInputPolicy();
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
    const styleTool = getRequiredElement("styleTool");
    const stylePanel = getRequiredElement("stylePanel");
    const stylePreviewDot = getRequiredElement("stylePreviewDot");
    const stylePreviewDotOutline = getRequiredElement("stylePreviewDotOutline");

    const positionStylePanel = () => {
      const rect = styleTool.getBoundingClientRect();
      const gap = 8;
      const panelWidth = stylePanel.offsetWidth || 200;
      let left = rect.right + gap;
      if (left + panelWidth > window.innerWidth - 8) {
        left = Math.max(8, rect.left - gap - panelWidth);
      }
      stylePanel.style.left = `${left}px`;
      stylePanel.style.top = `${rect.top}px`;
    };

    /** @type {ReturnType<typeof setTimeout> | null} */
    let stylePanelCloseTimer = null;
    const cancelStylePanelClose = () => {
      if (stylePanelCloseTimer !== null) {
        clearTimeout(stylePanelCloseTimer);
        stylePanelCloseTimer = null;
      }
    };
    const openStylePanelFromPointer = () => {
      cancelStylePanelClose();
      styleTool.classList.add("style-tool-open");
      positionStylePanel();
    };
    const scheduleStylePanelClose = () => {
      cancelStylePanelClose();
      stylePanelCloseTimer = setTimeout(() => {
        styleTool.classList.remove("style-tool-open");
        stylePanelCloseTimer = null;
      }, STYLE_PANEL_CLOSE_MS);
    };
    const repositionStylePanelIfOpen = () => {
      if (
        styleTool.classList.contains("style-tool-open") ||
        styleTool.contains(document.activeElement)
      ) {
        positionStylePanel();
      }
    };

    styleTool.addEventListener("mouseenter", openStylePanelFromPointer);
    styleTool.addEventListener("mouseleave", scheduleStylePanelClose);
    stylePanel.addEventListener("mouseenter", openStylePanelFromPointer);
    stylePanel.addEventListener("mouseleave", scheduleStylePanelClose);

    styleTool.addEventListener("focusin", () => {
      positionStylePanel();
    });
    window.addEventListener("resize", repositionStylePanelIfOpen, {
      passive: true,
    });
    window.addEventListener("scroll", repositionStylePanelIfOpen, {
      passive: true,
      capture: true,
    });
    const menuItems = document.getElementById("menuItems");
    if (menuItems) {
      menuItems.addEventListener("scroll", repositionStylePanelIfOpen, {
        passive: true,
      });
    }

    Tools.preferences.colorChooser = colorChooser;
    colorChooser.value = Tools.preferences.currentColor;
    colorChooser.onchange = colorChooser.oninput = () => {
      Tools.preferences.setColor(colorChooser.value);
    };

    sizeChooser.value = String(Tools.preferences.currentSize);
    sizeChooser.onchange = sizeChooser.oninput = () => {
      Tools.preferences.setSize(sizeChooser.value);
    };

    opacityChooser.value = String(Tools.preferences.currentOpacity);
    opacityChooser.onchange = opacityChooser.oninput = () => {
      Tools.preferences.setOpacity(opacityChooser.value);
    };

    const syncStyleAriaLabel = () => {
      styleTool.setAttribute(
        "aria-label",
        `${Tools.i18n.t("color")} ${Tools.preferences.currentColor}, ` +
          `${Tools.i18n.t("size")} ${Tools.preferences.currentSize}, ` +
          `${Tools.i18n.t("opacity")} ${Tools.preferences.currentOpacity}`,
      );
    };
    const updatePreview = () => {
      const r = styleSizeToPreviewRadius(Tools.preferences.currentSize);
      stylePreviewDot.setAttribute("fill", Tools.preferences.currentColor);
      stylePreviewDot.setAttribute(
        "fill-opacity",
        String(Tools.preferences.currentOpacity),
      );
      stylePreviewDot.setAttribute("r", String(r));
      stylePreviewDotOutline.setAttribute("r", String(r + 1.35));
      this.syncSelectedColorPreset();
      syncStyleAriaLabel();
    };
    Tools.preferences.colorChangeHandlers.push(updatePreview);
    Tools.preferences.sizeChangeHandlers.push(updatePreview);
    Tools.preferences.opacityChangeHandlers.push(updatePreview);

    if (!Tools.preferences.colorButtonsInitialized) {
      Tools.preferences.colorButtonsInitialized = true;
      this.addColorButtons();
      this.bindStyleKeyboardShortcuts();
    }
    Tools.preferences.setColor(Tools.preferences.currentColor);
    Tools.preferences.setSize(Tools.preferences.currentSize);
    Tools.preferences.setOpacity(Tools.preferences.currentOpacity);
  }

  bindStyleKeyboardShortcuts() {
    const Tools = this.getTools();
    const sizeChooser = getRequiredInput("chooseSize");
    const opacityChooser = getRequiredInput("chooseOpacity");
    const sizeMin = Number(sizeChooser.min) || LIMITS.MIN_SIZE;
    const sizeMax = Number(sizeChooser.max) || LIMITS.MAX_SIZE;
    const opacityMin = Number(opacityChooser.min) || LIMITS.MIN_OPACITY;
    const opacityMax = Number(opacityChooser.max) || LIMITS.MAX_OPACITY;
    /**
     * @param {number} delta
     * @returns {void}
     */
    const adjustSize = (delta) => {
      const next = Math.min(
        sizeMax,
        Math.max(sizeMin, Tools.preferences.getSize() + delta),
      );
      Tools.preferences.setSize(next);
    };
    /**
     * @param {number} delta
     * @returns {void}
     */
    const adjustOpacity = (delta) => {
      const next = Math.min(
        opacityMax,
        Math.max(opacityMin, Tools.preferences.getOpacity() + delta),
      );
      Tools.preferences.setOpacity(next);
    };
    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntryTarget(event.target)) return;
      const fineSize = event.shiftKey
        ? SIZE_KEY_STEP_FINE
        : SIZE_KEY_STEP_COARSE;
      const fineOpacity = event.shiftKey
        ? OPACITY_KEY_STEP_FINE
        : OPACITY_KEY_STEP_COARSE;
      switch (event.key) {
        case "[":
          adjustSize(-fineSize);
          break;
        case "]":
          adjustSize(fineSize);
          break;
        case ",":
        case "<":
          adjustOpacity(-fineOpacity);
          break;
        case ".":
        case ">":
          adjustOpacity(fineOpacity);
          break;
        default:
          return;
      }
      event.preventDefault();
    });
  }

  syncSelectedColorPreset() {
    const Tools = this.getTools();
    const container = document.getElementById("colorPresetSel");
    if (!container) return;
    const current = Tools.preferences.currentColor.toLowerCase();
    container
      .querySelectorAll(".colorPresetButton[data-color]")
      .forEach((element) => {
        if (!(element instanceof HTMLElement)) return;
        const swatch = (element.dataset.color || "").toLowerCase();
        element.setAttribute(
          "aria-pressed",
          swatch === current ? "true" : "false",
        );
      });
  }

  addColorButtons() {
    const Tools = this.getTools();
    const colorPresetContainer = getRequiredElement("colorPresetSel");
    const colorPresetTemplateElement =
      colorPresetContainer.querySelector(".colorPresetButton");
    if (!(colorPresetTemplateElement instanceof HTMLElement)) {
      throw new Error("Missing required color preset template");
    }
    const colorPresetTemplate = colorPresetTemplateElement;
    colorPresetTemplate.remove();

    Tools.preferences.colorPresets.forEach((button) => {
      this.addColorButton(colorPresetContainer, colorPresetTemplate, button);
    });
    this.addCustomColorButton(colorPresetContainer, colorPresetTemplate);
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
    elem.dataset.color = button.color;
    elem.setAttribute("aria-pressed", "false");
    const colorLabel = `${Tools.i18n.t("color")} ${button.color}`;
    elem.title = button.key
      ? `${colorLabel} — ${Tools.i18n.t("keyboard shortcut")}: ${button.key}`
      : colorLabel;
    elem.setAttribute("aria-label", colorLabel);
    colorPresetContainer.appendChild(elem);
    return elem;
  }

  /**
   * @param {HTMLElement} colorPresetContainer
   * @param {HTMLElement} colorPresetTemplate
   * @returns {HTMLElement}
   */
  addCustomColorButton(colorPresetContainer, colorPresetTemplate) {
    const Tools = this.getTools();
    const elem = colorPresetTemplate.cloneNode(true);
    if (!(elem instanceof HTMLElement)) {
      throw new Error("Color preset template clone must be an element");
    }
    elem.classList.add("colorPresetCustom");
    elem.id = "colorPresetCustom";
    const label = Tools.i18n.t("color");
    elem.title = label;
    elem.setAttribute("aria-label", label);
    elem.addEventListener("click", () => {
      const colorChooser = document.getElementById("chooseColor");
      if (colorChooser instanceof HTMLInputElement) {
        colorChooser.click();
      }
    });
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
