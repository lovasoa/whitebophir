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

/** @import { AppToolsState, BoardMessage, MountedAppTool, MountedAppToolsState, PendingMessages, RateLimitKind, ToolBootContext, ToolModule, ToolRuntimeState } from "../../types/app-runtime" */
/** @typedef {{tool: import("../tools/tool-order.js").ToolCode, type?: unknown, id?: unknown, parent?: string, txt?: unknown, _children?: unknown, clientMutationId?: string, socket?: string, userId?: string, color?: string, size?: number | string, opacity?: number, x?: number, y?: number, x2?: number, y2?: number, newid?: string, transform?: {a: number, b: number, c: number, d: number, e: number, f: number}}} RuntimeBoardMessage */
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
    this.bootedNames = new Set();
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
  if (toolName === "pencil") {
    await import("./path-data-polyfill.js");
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
 * @param {string} [ownerToolName]
 */
export function createToolRuntimeModules(mountedTools, ownerToolName = "") {
  return {
    board: mountedTools.dom,
    coordinates: mountedTools.coordinates,
    viewport: mountedTools.viewportState.controller,
    writes: {
      /** @param {RuntimeBoardMessage} message */
      drawAndSend(message) {
        return mountedTools.writes.drawAndSend(message);
      },
      /** @param {RuntimeBoardMessage} message */
      send(message) {
        return mountedTools.writes.send(message);
      },
      canBufferWrites() {
        return mountedTools.writes.canBufferWrites();
      },
      whenBoardWritable() {
        return mountedTools.writes.whenBoardWritable();
      },
    },
    identity: mountedTools.identity,
    preferences: {
      getColor() {
        return mountedTools.preferences.getColor();
      },
      getSize() {
        return mountedTools.preferences.getSize();
      },
      /** @param {number} size */
      setSize(size) {
        return mountedTools.preferences.setSize(size);
      },
      getOpacity() {
        return mountedTools.preferences.getOpacity();
      },
    },
    rateLimits: {
      /** @param {RateLimitKind} kind */
      getEffectiveRateLimit(kind) {
        return mountedTools.rateLimits.getEffectiveRateLimit(kind);
      },
    },
    toolRegistry: {
      get current() {
        return mountedTools.toolRegistry.current;
      },
      /** @param {string} toolName */
      change(toolName) {
        return mountedTools.toolRegistry.change(toolName);
      },
    },
    interaction: {
      get drawingEvent() {
        return mountedTools.interaction.drawingEvent;
      },
      set drawingEvent(value) {
        mountedTools.interaction.drawingEvent = value;
      },
      get showMarker() {
        return mountedTools.interaction.showMarker;
      },
      set showMarker(value) {
        mountedTools.interaction.showMarker = value;
      },
      get showMyCursor() {
        return mountedTools.interaction.showMyCursor;
      },
      set showMyCursor(value) {
        mountedTools.interaction.showMyCursor = value;
      },
      suppressOwnCursor() {
        return mountedTools.interaction.suppressOwnCursor(ownerToolName);
      },
      isOwnCursorSuppressed() {
        return mountedTools.interaction.isOwnCursorSuppressed();
      },
    },
    config: mountedTools.config,
    i18n: mountedTools.i18n,
    ui: mountedTools.ui,
    ids: mountedTools.ids,
    connection: mountedTools.connection,
    presence: mountedTools.presence,
    messages: {
      /** @param {RuntimeBoardMessage} message */
      messageForTool(message) {
        return mountedTools.messages.messageForTool(
          /** @type {BoardMessage} */ (/** @type {unknown} */ (message)),
        );
      },
    },
    permissions: {
      get canEdit() {
        return mountedTools.access.canEdit;
      },
      get canClear() {
        return mountedTools.access.canClear;
      },
      get canWrite() {
        return mountedTools.access.canEdit;
      },
    },
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
    runtime: createToolRuntimeModules(mountedTools, toolName),
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
  const draw = toolModule.draw;
  const normalizeServerRenderedElement =
    toolModule.normalizeServerRenderedElement;
  const press = toolModule.press;
  const move = toolModule.move;
  const release = toolModule.release;
  const cancelTouchGesture = toolModule.cancelTouchGesture;
  const onMessage = toolModule.onMessage;
  const onstart = toolModule.onstart;
  const onquit = toolModule.onquit;
  const onSocketDisconnect = toolModule.onSocketDisconnect;
  const flushPendingDraws = toolModule.flushPendingDraws;
  const onPresenceDisplayChange = toolModule.onPresenceDisplayChange;
  const onMutationRejected = toolModule.onMutationRejected;
  const onColorChange = toolModule.onColorChange;
  const onSizeChange = toolModule.onSizeChange;
  const onOpacityChange = toolModule.onOpacityChange;
  const touchListenerOptions = toolModule.touchListenerOptions;
  const getTouchPolicy = toolModule.getTouchPolicy;
  const toolDefinition = TOOL_BY_ID[toolName];
  /** @type {MountedAppTool} */
  const tool = {
    name: toolName,
    shortcut: toolModule.shortcut ?? toolDefinition?.shortcut,
    icon: "",
    draw: (message, isLocal) => draw(toolState, message, isLocal),
    normalizeServerRenderedElement: normalizeServerRenderedElement
      ? (element) => normalizeServerRenderedElement(toolState, element)
      : undefined,
    serverRenderedElementSelector: toolModule.serverRenderedElementSelector,
    press: press
      ? (x, y, evt, isTouchEvent) => press(toolState, x, y, evt, isTouchEvent)
      : undefined,
    move: move
      ? (x, y, evt, isTouchEvent) => move(toolState, x, y, evt, isTouchEvent)
      : undefined,
    release: release
      ? (x, y, evt, isTouchEvent) => release(toolState, x, y, evt, isTouchEvent)
      : undefined,
    cancelTouchGesture: cancelTouchGesture
      ? (evt) => cancelTouchGesture(toolState, evt)
      : undefined,
    onMessage: onMessage
      ? (message) => onMessage(toolState, message)
      : () => {},
    listeners: {},
    compiledListeners: {},
    onstart: onstart ? (oldTool) => onstart(toolState, oldTool) : () => {},
    onquit: onquit ? (newTool) => onquit(toolState, newTool) : () => {},
    onSocketDisconnect: onSocketDisconnect
      ? () => onSocketDisconnect(toolState)
      : () => {},
    flushPendingDraws: flushPendingDraws
      ? (message) => flushPendingDraws(toolState, message)
      : undefined,
    onPresenceDisplayChange: onPresenceDisplayChange
      ? () => onPresenceDisplayChange(toolState)
      : undefined,
    onMutationRejected: onMutationRejected
      ? (message, reason) => onMutationRejected(toolState, message, reason)
      : undefined,
    stylesheet: toolModule.stylesheet,
    oneTouch: toolModule.oneTouch ?? toolDefinition?.oneTouch,
    alwaysOn: toolModule.alwaysOn ?? toolDefinition?.alwaysOn,
    mouseCursor:
      toolModule.mouseCursor ??
      toolState.mouseCursor ??
      toolDefinition?.mouseCursor,
    helpText: toolModule.helpText ?? toolDefinition?.helpText,
    secondary: toolState.secondary ?? toolModule.secondary ?? null,
    onColorChange: onColorChange
      ? (color) => onColorChange(toolState, color)
      : undefined,
    onSizeChange: onSizeChange
      ? (size) => onSizeChange(toolState, size)
      : undefined,
    onOpacityChange: onOpacityChange
      ? (opacity) => onOpacityChange(toolState, opacity)
      : undefined,
    getTouchPolicy: getTouchPolicy
      ? () => getTouchPolicy(toolState)
      : undefined,
    showMarker: toolModule.showMarker ?? toolDefinition?.showMarker,
    requiredCapability:
      toolModule.requiredCapability ?? toolDefinition?.requiredCapability,
    touchListenerOptions,
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
