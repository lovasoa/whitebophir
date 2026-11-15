import {
  bindRenderedToolButtons,
  getRenderedToolNames,
  getToolButton,
  syncActiveToolState,
  syncMountedToolButton,
  toggleToolButtonMode,
  updateCurrentToolChrome,
} from "./board_tool_buttons.js";
import {
  bindToolKeyboardControls,
  compileToolListeners,
} from "./board_tool_input.js";
import {
  boardStateGrantsCapability,
  getToolIconPath,
  getToolModuleImportPath,
  getToolStylesheetPath,
  TOOL_BY_ID,
} from "../tools/manifest.js";
import { drainPendingMessages, isBlockedToolName } from "./board_page_state.js";
import MessageCommon from "./message_common.js";

/** @import { AppToolsState, BoardMessage, MountedAppTool, MountedAppToolsState, PendingMessages, ToolBootContext, ToolModule, ToolRuntimeModules, ToolRuntimeState } from "../../types/app-runtime" */
/** @typedef {{criticalToolNames: string[], pendingToolName: string}} InitialToolBootOptions */

/** @param {AppToolsState} Tools */
function getAttachedBoardDom(Tools) {
  return Tools.dom.status === "attached" ? Tools.dom : null;
}

/**
 * @param {MountedAppTool} tool
 * @returns {boolean}
 */
function activationSendsCapabilityMutation(tool) {
  return tool.oneTouch === true && tool.requiredCapability != null;
}

function noop() {}

export class ToolRegistryModule {
  /**
   * @param {() => AppToolsState} getTools
   * @param {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} logger
   */
  constructor(getTools, logger) {
    this.getTools = getTools;
    this.logBoardEvent = logger;
    this.keyboardBound = false;
    this.current =
      /** @type {import("../../types/app-runtime").MaybeMountedAppTool} */ (
        null
      );
    this.mounted =
      /** @type {import("../../types/app-runtime").MountedToolRegistry} */ ({});
    this.bootPromises =
      /** @type {import("../../types/app-runtime").ToolNameMap<import("../../types/app-runtime").MountedAppToolPromise>} */ ({});
    this.lazyBootEnabled = false;
    this.pendingMessages = /** @type {PendingMessages} */ ({});
  }

  /**
   * @param {ToolModule} toolModule
   * @param {ToolRuntimeState} toolState
   * @param {string} toolName
   */
  mountTool(toolModule, toolState, toolName) {
    const Tools = this.getTools();
    const mountedTool = createMountedTool(
      Tools,
      toolModule,
      toolState,
      toolName,
    );
    if (mountedTool.stylesheet) {
      addToolStylesheet(Tools, mountedTool.stylesheet);
    }
    if (this.isBlocked(mountedTool)) return null;

    if (toolName in this.mounted) {
      this.logBoardEvent("warn", "tool.mount_replaced", {
        toolName,
      });
    }

    this.mounted[toolName] = mountedTool;

    if (mountedTool.onColorChange) {
      Tools.preferences.colorChangeHandlers.push(mountedTool.onColorChange);
    }
    if (mountedTool.onSizeChange) {
      Tools.preferences.sizeChangeHandlers.push(mountedTool.onSizeChange);
    }
    if (mountedTool.onOpacityChange) {
      Tools.preferences.opacityChangeHandlers.push(mountedTool.onOpacityChange);
    }

    const pending = drainPendingMessages(this.pendingMessages, toolName);
    if (pending.length > 0) {
      this.logBoardEvent("log", "tool.pending_replayed", {
        toolName,
        count: pending.length,
      });
      pending.forEach((/** @type {BoardMessage} */ msg) => {
        mountedTool.draw(msg, false);
      });
    }
    if (this.shouldDisplayTool(toolName)) {
      syncMountedToolButton(Tools, toolName);
    }
    this.syncToolDisabledState(toolName);
    if (mountedTool.alwaysOn === true) {
      this.addToolListeners(mountedTool);
    }
    this.normalizeServerRenderedElementsForTool(mountedTool);
    return mountedTool;
  }

  /** @param {string} toolName */
  async bootTool(toolName) {
    const Tools = this.getTools();
    const existingTool = this.mounted[toolName];
    if (existingTool) return existingTool;
    const inFlight = this.bootPromises[toolName];
    if (inFlight) return inFlight;

    const promise = bootToolPromise(Tools, toolName);
    this.bootPromises[toolName] = promise;
    try {
      return await promise;
    } catch (error) {
      // A deployment can remove a tool's release while a board is open; ask
      // for the same refresh the boot loader asks for.
      Tools.status.showUnknownMutationError("");
      throw error;
    } finally {
      delete this.bootPromises[toolName];
    }
  }

  /** @param {string} toolName */
  async activateTool(toolName) {
    const Tools = this.getTools();
    if (!this.shouldDisplayTool(toolName)) return false;
    const tool = await this.bootTool(toolName);
    if (!tool || !this.shouldDisplayTool(toolName)) return false;
    if (
      activationSendsCapabilityMutation(tool) &&
      !Tools.writes.canBufferWrites()
    ) {
      await Tools.writes.whenBoardWritable();
      if (!this.shouldDisplayTool(toolName)) return false;
    }
    return this.change(toolName) === true;
  }

  /** @param {MountedAppTool} tool */
  addToolListeners(tool) {
    const Tools = this.getTools();
    const dom = getAttachedBoardDom(Tools);
    if (!tool.compiledListeners) return;
    for (const event in tool.compiledListeners) {
      const listener = tool.compiledListeners[event];
      if (!listener) continue;
      const target = listener.target || dom?.board;
      if (!target) continue;
      target.addEventListener(
        event,
        listener,
        event.startsWith("touch")
          ? tool.touchListenerOptions || { passive: false }
          : { passive: false },
      );
    }
  }

  /** @param {MountedAppTool} tool */
  removeToolListeners(tool) {
    const Tools = this.getTools();
    const dom = getAttachedBoardDom(Tools);
    if (!tool.compiledListeners) return;
    for (const event in tool.compiledListeners) {
      const listener = tool.compiledListeners[event];
      if (!listener) continue;
      const target = listener.target || dom?.board;
      if (!target) continue;
      target.removeEventListener(event, listener);
    }
  }

  syncActiveToolInputPolicy() {
    const Tools = this.getTools();
    Tools.viewportState.controller.setTouchPolicy(
      this.current?.getTouchPolicy?.() || "app-gesture",
    );
  }

  /** @param {TouchEvent} event */
  cancelActiveTouchGesture(event) {
    this.current?.cancelTouchGesture?.(event);
  }

  /** @param {string} toolName */
  shouldDisableTool(toolName) {
    const Tools = this.getTools();
    return (
      MessageCommon.isDrawTool(toolName) &&
      !MessageCommon.isDrawToolAllowedAtScale(Tools.viewportState.scale)
    );
  }

  /** @param {string} toolName */
  shouldDisplayTool(toolName) {
    const Tools = this.getTools();
    if (getToolButton(toolName) === null) return false;
    // A tool is only shown when the current board state grants its capability,
    // mirroring the server-rendered initial visibility. This keeps read-only users (e.g.
    // banned ones) from seeing or activating tools they cannot use.
    return boardStateGrantsCapability(
      Tools.access.boardState,
      TOOL_BY_ID[toolName]?.requiredCapability,
    );
  }

  /** @param {string} toolName */
  canInteractWithTool(toolName) {
    const Tools = this.getTools();
    return (
      this.shouldDisplayTool(toolName) &&
      !this.shouldDisableTool(toolName) &&
      (!TOOL_BY_ID[toolName]?.requiredCapability ||
        Tools.writes.canBufferWrites())
    );
  }

  syncCurrentToolChrome() {
    const Tools = this.getTools();
    if (!this.current) return;
    updateCurrentToolChrome(
      Tools,
      this.current.name,
      this.current,
      this.logBoardEvent,
    );
  }

  /** @param {string} toolName */
  syncToolDisabledState(toolName) {
    const toolElem = document.getElementById(`toolID-${toolName}`);
    if (!toolElem) return;
    const disabled =
      !this.mounted[toolName] || !this.canInteractWithTool(toolName);
    toolElem.classList.toggle("disabledTool", disabled);
    toolElem.setAttribute("aria-disabled", disabled ? "true" : "false");
  }

  syncRenderedToolAvailability() {
    this.getRenderedToolNames().forEach((toolName) => {
      const toolElem = getToolButton(toolName);
      if (!toolElem) return;
      const visible = this.shouldDisplayTool(toolName);
      toolElem.hidden = !visible;
      if (!visible) return;
      const icon = toolElem.querySelector(".tool-icon");
      if (icon instanceof HTMLImageElement && icon.dataset.iconUrl) {
        icon.src = icon.dataset.iconUrl;
        delete icon.dataset.iconUrl;
      }
      if (this.lazyBootEnabled) void this.bootTool(toolName);
    });
  }

  /** @param {boolean} force */
  syncDrawToolAvailability(force) {
    const Tools = this.getTools();
    const drawToolsAllowed = MessageCommon.isDrawToolAllowedAtScale(
      Tools.viewportState.scale,
    );
    if (!force && drawToolsAllowed === Tools.viewportState.drawToolsAllowed) {
      return;
    }
    Tools.viewportState.drawToolsAllowed = drawToolsAllowed;

    Object.keys(this.mounted || {}).forEach((toolName) => {
      this.syncToolDisabledState(toolName);
    });
    this.syncCurrentToolChrome();
  }

  /** @param {MountedAppTool} tool */
  isBlocked(tool) {
    const Tools = this.getTools();
    return isBlockedToolName(
      tool.name,
      Tools.config.serverConfig.BLOCKED_TOOLS || [],
    );
  }

  /** @param {string} toolName */
  change(toolName) {
    const Tools = this.getTools();
    const newTool = this.mounted[toolName];
    const oldTool = this.current;
    if (!newTool)
      throw new Error("Trying to select a tool that has never been added!");
    if (newTool === oldTool) {
      toggleSecondaryTool(Tools, newTool);
      return;
    }
    if (!newTool.oneTouch) {
      updateCurrentToolChrome(Tools, toolName, newTool, this.logBoardEvent);
      replaceCurrentTool(Tools, newTool);
    }

    if (newTool.onstart) newTool.onstart(oldTool);
    this.syncActiveToolInputPolicy();
    return true;
  }

  bindRenderedToolButtons() {
    const Tools = this.getTools();
    if (!this.keyboardBound) {
      bindToolKeyboardControls(Tools);
      this.keyboardBound = true;
    }
    bindRenderedToolButtons(Tools);
  }

  /**
   * @param {InitialToolBootOptions} options
   * @returns {Promise<void>}
   */
  async bootInitialTools(options) {
    const visibleToolNames = new Set(
      this.getRenderedToolNames().filter((toolName) =>
        this.shouldDisplayTool(toolName),
      ),
    );
    for (const toolName of options.criticalToolNames) {
      if (!visibleToolNames.has(toolName)) continue;
      await this.bootTool(toolName);
    }
    if (options.pendingToolName) {
      await this.activateTool(options.pendingToolName);
    }
    if (
      !this.current &&
      this.mounted.hand &&
      this.canInteractWithTool("hand")
    ) {
      this.change("hand");
    }
  }

  /**
   * @param {ReadonlySet<string>} skippedToolNames
   * @returns {Promise<void>}
   */
  scheduleLazyBootRenderedTools(skippedToolNames) {
    this.lazyBootEnabled = true;
    return this.scheduleLazyBootToolNames(
      [
        ...this.getRenderedToolNames().filter((toolName) =>
          this.shouldDisplayTool(toolName),
        ),
        "cursor",
      ],
      skippedToolNames,
    );
  }

  /**
   * @param {string[]} toolNames
   * @param {ReadonlySet<string>} skippedToolNames
   * @returns {Promise<void>}
   */
  scheduleLazyBootToolNames(toolNames, skippedToolNames) {
    const schedule =
      window.requestIdleCallback ||
      /**
       * @param {(deadline?: IdleDeadline) => void} callback
       */
      ((callback) => {
        return window.setTimeout(
          () =>
            callback({
              didTimeout: false,
              timeRemaining: () => 0,
            }),
          50,
        );
      });
    const pendingBoots = toolNames
      .filter((toolName, index) => toolNames.indexOf(toolName) === index)
      .filter((toolName) => !skippedToolNames.has(toolName))
      .map((toolName) => {
        return new Promise((resolve, reject) => {
          schedule(() => {
            this.bootTool(toolName).then(resolve, reject);
          });
        });
      });
    return Promise.all(pendingBoots).then(() => {});
  }

  /**
   * @returns {string[]}
   */
  getRenderedToolNames() {
    return getRenderedToolNames();
  }

  /** @param {MountedAppTool} tool */
  normalizeServerRenderedElementsForTool(tool) {
    const Tools = this.getTools();
    const dom = getAttachedBoardDom(Tools);
    if (!dom) return;
    const selector = tool.serverRenderedElementSelector;
    const normalizeElement = tool.normalizeServerRenderedElement;
    if (!selector || !normalizeElement) return;

    dom.drawingArea
      .querySelectorAll(selector)
      .forEach((/** @type {Element} */ element) => {
        if (element instanceof SVGElement) {
          normalizeElement.call(tool, element);
        }
      });
  }

  normalizeServerRenderedElements() {
    Object.values(this.mounted).forEach((tool) => {
      this.normalizeServerRenderedElementsForTool(tool);
    });
  }

  /** @param {BoardMessage} [message] */
  flushPendingDraws(message) {
    for (const name in this.mounted)
      this.mounted[name]?.flushPendingDraws?.(message);
  }

  notifyPresenceDisplayChange() {
    Object.values(this.mounted).forEach((tool) => {
      tool.onPresenceDisplayChange?.();
    });
  }
}

/**
 * @param {AppToolsState} Tools
 * @param {string} href
 * @returns {HTMLLinkElement}
 */
function addToolStylesheet(Tools, href) {
  const resolvedHref = Tools.assets.resolveAssetPath(href);
  const existing = Array.from(
    document.querySelectorAll('link[rel="stylesheet"]'),
  ).find((link) => link.getAttribute("href") === resolvedHref);
  if (existing instanceof HTMLLinkElement) return existing;
  const link = document.createElement("link");
  link.href = resolvedHref;
  link.rel = "stylesheet";
  link.type = "text/css";
  document.head.appendChild(link);
  return link;
}

/**
 * @param {string} toolName
 * @returns {Promise<ToolModule>}
 */
async function loadToolModule(toolName) {
  if (!isRegisteredToolId(toolName)) {
    throw new Error(`Unknown tool module: ${toolName}.`);
  }
  return /** @type {ToolModule} */ (
    await import(getToolModuleImportPath(toolName))
  );
}

/**
 * @param {string} toolName
 * @returns {boolean}
 */
function isRegisteredToolId(toolName) {
  return Object.prototype.hasOwnProperty.call(TOOL_BY_ID, toolName);
}

/**
 * @param {MountedAppToolsState} mountedTools
 * @returns {ToolRuntimeModules}
 */
export function createToolRuntimeModules(mountedTools) {
  return {
    board: mountedTools.dom,
    coordinates: mountedTools.coordinates,
    viewport: mountedTools.viewportState.controller,
    writes: mountedTools.writes,
    identity: mountedTools.identity,
    preferences: mountedTools.preferences,
    rateLimits: mountedTools.rateLimits,
    toolRegistry: mountedTools.toolRegistry,
    interaction: mountedTools.interaction,
    config: mountedTools.config,
    i18n: mountedTools.i18n,
    ui: mountedTools.ui,
    ids: mountedTools.ids,
    connection: mountedTools.connection,
    presence: mountedTools.presence,
    permissions: mountedTools.access,
  };
}

/**
 * @param {AppToolsState} Tools
 * @param {string} toolName
 * @returns {ToolBootContext}
 */
function createToolBootContext(Tools, toolName) {
  /** @type {MountedAppToolsState} */
  const mountedTools = (() => {
    if (Tools.dom.status !== "attached") {
      throw new Error("Tool boot requires board, svg, and drawing area.");
    }
    return /** @type {MountedAppToolsState} */ (Tools);
  })();
  return {
    runtime: createToolRuntimeModules(mountedTools),
    canDeferDraws:
      mountedTools.optimistic.flushesPendingToolDraws === true &&
      mountedTools.replay.resetsPendingToolDraws === true,
    assetUrl(assetFile) {
      return mountedTools.assets.getToolAssetUrl(toolName, assetFile);
    },
  };
}

/**
 * @param {AppToolsState} Tools
 * @param {ToolModule} toolModule
 * @param {ToolRuntimeState} toolState
 * @param {string} toolName
 * @returns {MountedAppTool}
 */
function createMountedTool(Tools, toolModule, toolState, toolName) {
  const toolDefinition = TOOL_BY_ID[toolName];
  /** @type {MountedAppTool} */
  const tool = {
    name: toolName,
    shortcut: toolModule.shortcut ?? toolDefinition?.shortcut,
    icon: "",
    draw: toolModule.draw.bind(undefined, toolState),
    normalizeServerRenderedElement:
      toolModule.normalizeServerRenderedElement?.bind(undefined, toolState),
    serverRenderedElementSelector: toolModule.serverRenderedElementSelector,
    press: toolModule.press?.bind(undefined, toolState),
    move: toolModule.move?.bind(undefined, toolState),
    release: toolModule.release?.bind(undefined, toolState),
    cancelTouchGesture: toolModule.cancelTouchGesture?.bind(
      undefined,
      toolState,
    ),
    onMessage: toolModule.onMessage?.bind(undefined, toolState) ?? noop,
    listeners: {},
    compiledListeners: {},
    onstart: toolModule.onstart?.bind(undefined, toolState) ?? noop,
    onquit: toolModule.onquit?.bind(undefined, toolState) ?? noop,
    onSocketDisconnect:
      toolModule.onSocketDisconnect?.bind(undefined, toolState) ?? noop,
    flushPendingDraws: toolModule.flushPendingDraws?.bind(undefined, toolState),
    onPresenceDisplayChange: toolModule.onPresenceDisplayChange?.bind(
      undefined,
      toolState,
    ),
    onMutationRejected: toolModule.onMutationRejected?.bind(
      undefined,
      toolState,
    ),
    stylesheet: toolModule.stylesheet,
    oneTouch: toolModule.oneTouch ?? toolDefinition?.oneTouch,
    alwaysOn: toolModule.alwaysOn ?? toolDefinition?.alwaysOn,
    mouseCursor:
      toolModule.mouseCursor ??
      toolState.mouseCursor ??
      toolDefinition?.mouseCursor,
    helpText: toolModule.helpText ?? toolDefinition?.helpText,
    secondary: toolState.secondary ?? toolModule.secondary ?? null,
    onColorChange: toolModule.onColorChange?.bind(undefined, toolState),
    onSizeChange: toolModule.onSizeChange?.bind(undefined, toolState),
    onOpacityChange: toolModule.onOpacityChange?.bind(undefined, toolState),
    getTouchPolicy: toolModule.getTouchPolicy?.bind(undefined, toolState),
    showMarker: toolModule.showMarker ?? toolDefinition?.showMarker,
    requiredCapability:
      toolModule.requiredCapability ?? toolDefinition?.requiredCapability,
    touchListenerOptions: toolModule.touchListenerOptions,
  };
  if (toolDefinition) {
    tool.icon ||= getToolIconPath(toolDefinition.toolId);
    tool.stylesheet ||=
      getToolStylesheetPath(
        toolDefinition.toolId,
        toolDefinition.drawsOnBoard,
      ) || undefined;
  }
  tool.listeners = {
    press: tool.press,
    move: tool.move,
    release: tool.release,
  };

  tool.compiledListeners = compileToolListeners(Tools, tool);
  return tool;
}

/**
 * @param {AppToolsState} Tools
 * @param {string} toolName
 * @returns {Promise<MountedAppTool | null>}
 */
async function bootToolPromise(Tools, toolName) {
  const toolModule = await loadToolModule(toolName);
  const toolState = /** @type {ToolRuntimeState} */ (
    await toolModule.boot(createToolBootContext(Tools, toolName))
  );
  return Tools.toolRegistry.mountTool(toolModule, toolState, toolName);
}

/**
 * @param {AppToolsState} Tools @param {MountedAppTool} newTool */
function toggleSecondaryTool(Tools, newTool) {
  if (!newTool.secondary) return;
  newTool.secondary.active = !newTool.secondary.active;
  const props = newTool.secondary.active ? newTool.secondary : newTool;
  toggleToolButtonMode(Tools, {
    toolName: newTool.name,
    labelKey: props.name,
    icon: props.icon,
    shortcut: newTool.shortcut,
  });
  if (newTool.secondary.switch) newTool.secondary.switch();
  syncActiveToolState(Tools);
  Tools.toolRegistry.syncActiveToolInputPolicy();
}

/**
 * @param {AppToolsState} Tools @param {MountedAppTool} newTool */
function replaceCurrentTool(Tools, newTool) {
  const currentTool = Tools.toolRegistry.current;
  if (currentTool !== null) {
    Tools.toolRegistry.removeToolListeners(currentTool);
    currentTool.onquit && currentTool.onquit(newTool);
    Tools.interaction.releaseOwner(currentTool.name);
  }
  Tools.toolRegistry.addToolListeners(newTool);
  Tools.toolRegistry.current = newTool;
  syncActiveToolState(Tools);
}
