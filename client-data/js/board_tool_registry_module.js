import {
  getToolIconPath,
  getToolModuleImportPath,
  getToolStylesheetPath,
  TOOL_BY_ID,
} from "../tools/manifest.js";
import {
  drainPendingMessages,
  getRequiredElement,
  isBlockedToolName,
} from "./board_page_state.js";
import MessageCommon from "./message_common.js";

/** @import { AppToolsState, BoardMessage, CompiledToolListener, CompiledToolListeners, MountedAppTool, MountedAppToolsState, PendingMessages, RateLimitKind, ToolBootContext, ToolModule, ToolPointerListener, ToolRuntimeState } from "../../types/app-runtime" */
/** @typedef {{tool: import("../tools/tool-order.js").ToolCode, type?: unknown, id?: unknown, txt?: unknown, _children?: unknown, clientMutationId?: string, socket?: string, userId?: string, color?: string, size?: number | string}} RuntimeBoardMessage */
/** @typedef {{criticalToolNames: string[], pendingToolName: string}} InitialToolBootOptions */

/** @type {AppToolsState} */
let Tools;
/** @type {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} */
let logBoardEvent = () => {};

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
 * @param {EventTarget | null} target
 * @returns {target is HTMLInputElement | HTMLTextAreaElement}
 */
function isTextEntryTarget(target) {
  return (
    (target instanceof HTMLInputElement && target.type === "text") ||
    target instanceof HTMLTextAreaElement
  );
}

function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function getAttachedBoardDom() {
  return Tools.dom.status === "attached" ? Tools.dom : null;
}

export class ToolRegistryModule {
  /**
   * @param {() => AppToolsState} getTools
   * @param {(level: "error" | "log" | "warn", event: string, fields?: {[key: string]: unknown}) => void} logger
   */
  constructor(getTools, logger) {
    Tools = getTools();
    logBoardEvent = logger;
    this.current =
      /** @type {import("../../types/app-runtime").MaybeMountedAppTool} */ (
        null
      );
    this.mounted =
      /** @type {import("../../types/app-runtime").MountedToolRegistry} */ ({});
    this.bootPromises =
      /** @type {import("../../types/app-runtime").ToolNameMap<import("../../types/app-runtime").MountedAppToolPromise>} */ ({});
    this.bootedNames = new Set();
    this.pendingMessages = /** @type {PendingMessages} */ ({});
  }

  /**
   * @param {ToolModule} toolModule
   * @param {ToolRuntimeState} toolState
   * @param {string} toolName
   */
  mountTool(toolModule, toolState, toolName) {
    const mountedTool = createMountedTool(toolModule, toolState, toolName);
    if (mountedTool.stylesheet) {
      addToolStylesheet(mountedTool.stylesheet);
    }
    if (this.isBlocked(mountedTool)) return null;

    if (toolName in this.mounted) {
      logBoardEvent("warn", "tool.mount_replaced", {
        toolName,
      });
    }

    this.mounted[toolName] = mountedTool;

    if (mountedTool.onSizeChange) {
      Tools.preferences.sizeChangeHandlers.push(mountedTool.onSizeChange);
    }

    const pending = drainPendingMessages(this.pendingMessages, toolName);
    if (pending.length > 0) {
      logBoardEvent("log", "tool.pending_replayed", {
        toolName,
        count: pending.length,
      });
      pending.forEach((/** @type {BoardMessage} */ msg) => {
        mountedTool.draw(msg, false);
      });
    }
    if (this.shouldDisplayTool(toolName)) {
      syncMountedToolButton(toolName);
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
    const existingTool = this.mounted[toolName];
    if (existingTool) return existingTool;
    const inFlight = this.bootPromises[toolName];
    if (inFlight) return inFlight;

    const promise = bootToolPromise(toolName);
    this.bootPromises[toolName] = promise;
    try {
      return await promise;
    } finally {
      delete this.bootPromises[toolName];
    }
  }

  /** @param {string} toolName */
  async activateTool(toolName) {
    if (!this.shouldDisplayTool(toolName)) return false;
    const tool = await this.bootTool(toolName);
    if (!tool || !this.canUseTool(toolName)) return false;
    if (
      tool.requiresWritableBoard === true &&
      !Tools.writes.canBufferWrites()
    ) {
      await Tools.writes.whenBoardWritable();
      if (!this.canUseTool(toolName)) return false;
    }
    return this.change(toolName) !== false;
  }

  /** @param {MountedAppTool} tool */
  addToolListeners(tool) {
    const dom = getAttachedBoardDom();
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
    const dom = getAttachedBoardDom();
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
    Tools.viewportState.controller.setTouchPolicy(
      this.current?.getTouchPolicy?.() || "app-gesture",
    );
  }

  /** @param {string} toolName */
  shouldDisableTool(toolName) {
    return (
      MessageCommon.isDrawTool(toolName) &&
      !MessageCommon.isDrawToolAllowedAtScale(Tools.viewportState.scale)
    );
  }

  /** @param {string} toolName */
  shouldDisplayTool(toolName) {
    return getToolButton(toolName) !== null;
  }

  /** @param {string} toolName */
  canUseTool(toolName) {
    return (
      this.shouldDisplayTool(toolName) && !this.shouldDisableTool(toolName)
    );
  }

  /** @param {string} toolName */
  syncToolDisabledState(toolName) {
    const toolElem = document.getElementById(`toolID-${toolName}`);
    if (!toolElem) return;
    const disabled =
      !this.mounted[toolName] || this.shouldDisableTool(toolName);
    toolElem.classList.toggle("disabledTool", disabled);
    toolElem.setAttribute("aria-disabled", disabled ? "true" : "false");
  }

  /** @param {boolean} force */
  syncDrawToolAvailability(force) {
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

    if (
      !drawToolsAllowed &&
      this.current &&
      MessageCommon.isDrawTool(this.current.name) &&
      this.mounted.hand
    ) {
      this.change("hand");
    }
  }

  /** @param {MountedAppTool} tool */
  isBlocked(tool) {
    return isBlockedToolName(
      tool.name,
      Tools.config.serverConfig.BLOCKED_TOOLS || [],
    );
  }

  /** @param {string} toolName */
  change(toolName) {
    const newTool = this.mounted[toolName];
    const oldTool = this.current;
    if (!newTool)
      throw new Error("Trying to select a tool that has never been added!");
    if (this.shouldDisableTool(toolName)) return false;
    if (newTool === oldTool) {
      toggleSecondaryTool(newTool);
      return;
    }
    if (!newTool.oneTouch) {
      updateCurrentToolChrome(toolName, newTool);
      replaceCurrentTool(newTool);
    }

    if (newTool.onstart) newTool.onstart(oldTool);
    this.syncActiveToolInputPolicy();
    return true;
  }

  bindRenderedToolButtons() {
    bindRenderedToolButtons();
  }

  /**
   * @param {InitialToolBootOptions} options
   * @returns {Promise<void>}
   */
  async bootInitialTools(options) {
    const visibleToolNames = new Set(this.getRenderedToolNames());
    for (const toolName of options.criticalToolNames) {
      if (!visibleToolNames.has(toolName)) continue;
      await this.bootTool(toolName);
    }
    if (options.pendingToolName) {
      await this.activateTool(options.pendingToolName);
    }
    if (!this.current && this.mounted.hand && this.canUseTool("hand")) {
      this.change("hand");
    }
  }

  /**
   * @param {ReadonlySet<string>} skippedToolNames
   * @returns {Promise<void>}
   */
  scheduleLazyBootRenderedTools(skippedToolNames) {
    return this.scheduleLazyBootToolNames(
      [...this.getRenderedToolNames(), "cursor"],
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
    const dom = getAttachedBoardDom();
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
}

/**
 * @param {HTMLElement} button
 * @param {string} toolName
 * @returns {void}
 */
function bindToolButton(button, toolName) {
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
function getToolButton(toolName) {
  const button = document.getElementById(`toolID-${toolName}`);
  return button instanceof HTMLElement ? button : null;
}

/**
 * @param {string} toolName
 * @param {MountedAppTool} tool
 * @returns {void}
 */
function syncToolButton(toolName, tool) {
  const button = getToolButton(toolName);
  if (!button) return;
  bindToolButton(button, toolName);
  const parts = getRequiredToolButtonParts(toolName);
  const translatedToolName = Tools.i18n.t(toolName);
  parts.label.textContent = translatedToolName;
  button.setAttribute("aria-label", translatedToolName);
  parts.primaryIcon.src = Tools.assets.resolveAssetPath(tool.icon);
  parts.primaryIcon.alt = "";
  button.classList.toggle("oneTouch", tool.oneTouch === true);
  button.classList.toggle("hasSecondary", !!tool.secondary);
  parts.primaryIcon.classList.toggle("primaryIcon", !!tool.secondary);
  button.title = tool.shortcut
    ? `${translatedToolName} (${Tools.i18n.t("keyboard shortcut")}: ${tool.shortcut})`
    : translatedToolName;
  if (tool.secondary && parts.secondaryIcon) {
    parts.secondaryIcon.src = Tools.assets.resolveAssetPath(
      tool.secondary.icon,
    );
    parts.secondaryIcon.alt = "";
    button.title += ` [${Tools.i18n.t("click_to_toggle")}]`;
  } else if (parts.secondaryIcon) {
    parts.secondaryIcon.src = "data:,";
    parts.secondaryIcon.alt = "";
  }
}

function bindRenderedToolButtons() {
  document
    .querySelectorAll("#tools > .tool[data-tool-id]")
    .forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const toolName = element.dataset.toolId;
      if (!toolName) return;
      bindToolButton(element, toolName);
    });
}

/**
 * @returns {string[]}
 */
function getRenderedToolNames() {
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
 * @param {string} toolName
 * @returns {HTMLElement | null}
 */
function syncMountedToolButton(toolName) {
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
  syncToolButton(toolName, tool);
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
  if (oldTool) oldTool.classList.remove("curTool");
  if (newTool) newTool.classList.add("curTool");
}

/**
 * @param {string} toolName
 * @param {string} name
 * @param {string} icon
 * @returns {void}
 */
function toggleToolButtonMode(toolName, name, icon) {
  const parts = getRequiredToolButtonParts(toolName);
  const secondaryIcon = parts.secondaryIcon;
  if (!secondaryIcon) {
    throw new Error(`Missing secondary icon for tool ${toolName}`);
  }
  const primaryIconSrc = parts.primaryIcon.src;
  parts.primaryIcon.src = secondaryIcon.src;
  secondaryIcon.src = primaryIconSrc;
  parts.primaryIcon.src = Tools.assets.resolveAssetPath(icon);
  parts.label.textContent = Tools.i18n.t(name);
}

/**
 * @param {string} href
 * @returns {HTMLLinkElement}
 */
function addToolStylesheet(href) {
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
  return Object.hasOwn(TOOL_BY_ID, toolName);
}

/**
 * @param {MountedAppToolsState} mountedTools
 */
export function createToolRuntimeModules(mountedTools) {
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
      /** @param {number | string | null | undefined} size */
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
    },
    config: mountedTools.config,
    ids: mountedTools.ids,
    messages: {
      /** @param {RuntimeBoardMessage} message */
      messageForTool(message) {
        return mountedTools.messages.messageForTool(
          /** @type {BoardMessage} */ (/** @type {unknown} */ (message)),
        );
      },
    },
    permissions: {
      get canWrite() {
        return mountedTools.access.canWrite;
      },
    },
  };
}

/**
 * @param {string} toolName
 * @returns {ToolBootContext}
 */
function createToolBootContext(toolName) {
  /** @type {MountedAppToolsState} */
  const mountedTools = (() => {
    if (Tools.dom.status !== "attached") {
      throw new Error("Tool boot requires board, svg, and drawing area.");
    }
    return /** @type {MountedAppToolsState} */ (Tools);
  })();
  return {
    runtime: createToolRuntimeModules(mountedTools),
    assetUrl(assetFile) {
      return mountedTools.assets.getToolAssetUrl(toolName, assetFile);
    },
  };
}

/**
 * @param {ToolModule} toolModule
 * @param {ToolRuntimeState} toolState
 * @param {string} toolName
 * @returns {MountedAppTool}
 */
function createMountedTool(toolModule, toolState, toolName) {
  const draw = toolModule.draw;
  const normalizeServerRenderedElement =
    toolModule.normalizeServerRenderedElement;
  const press = toolModule.press;
  const move = toolModule.move;
  const release = toolModule.release;
  const onMessage = toolModule.onMessage;
  const onstart = toolModule.onstart;
  const onquit = toolModule.onquit;
  const onSocketDisconnect = toolModule.onSocketDisconnect;
  const onMutationRejected = toolModule.onMutationRejected;
  const onSizeChange = toolModule.onSizeChange;
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
    onMutationRejected: onMutationRejected
      ? (message, reason) => onMutationRejected(toolState, message, reason)
      : undefined,
    stylesheet: undefined,
    oneTouch: toolModule.oneTouch ?? toolDefinition?.oneTouch,
    alwaysOn: toolModule.alwaysOn ?? toolDefinition?.alwaysOn,
    mouseCursor:
      toolModule.mouseCursor ??
      toolState.mouseCursor ??
      toolDefinition?.mouseCursor,
    helpText: toolModule.helpText ?? toolDefinition?.helpText,
    secondary: toolState.secondary ?? toolModule.secondary ?? null,
    onSizeChange: onSizeChange
      ? (size) => onSizeChange(toolState, size)
      : undefined,
    getTouchPolicy: getTouchPolicy
      ? () => getTouchPolicy(toolState)
      : undefined,
    showMarker: toolModule.showMarker ?? toolDefinition?.showMarker,
    requiresWritableBoard:
      toolModule.requiresWritableBoard ?? toolDefinition?.requiresWritableBoard,
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

  /**
   * @param {ToolPointerListener} listener
   * @param {boolean} isTouchEvent
   * @returns {CompiledToolListener}
   */
  function compilePointerListener(listener, isTouchEvent) {
    return function handlePointer(evt) {
      if (isTouchEvent) {
        const touchEvent = /** @type {TouchEvent} */ (evt);
        if (touchEvent.changedTouches.length !== 1) return true;
        if (
          (touchEvent.type === "touchstart" ||
            touchEvent.type === "touchmove") &&
          touchEvent.touches.length !== 1
        ) {
          return true;
        }
        if (
          (touchEvent.type === "touchend" ||
            touchEvent.type === "touchcancel") &&
          touchEvent.touches.length !== 0
        ) {
          return true;
        }
        const touch = touchEvent.changedTouches[0];
        if (!touch) return true;
        return listener(
          Tools.coordinates.pageCoordinateToBoard(touch.pageX),
          Tools.coordinates.pageCoordinateToBoard(touch.pageY),
          touchEvent,
          true,
        );
      }
      const mouseEvent = /** @type {MouseEvent} */ (evt);
      return listener(
        Tools.coordinates.pageCoordinateToBoard(mouseEvent.pageX),
        Tools.coordinates.pageCoordinateToBoard(mouseEvent.pageY),
        mouseEvent,
        false,
      );
    };
  }

  /**
   * @param {CompiledToolListener} listener
   * @returns {CompiledToolListener}
   */
  function wrapUnsetHover(listener) {
    return function unsetHover(evt) {
      blurActiveElement();
      return listener(evt);
    };
  }

  const compiled = /** @type {CompiledToolListeners} */ ({});
  if (tool.listeners.press) {
    compiled.mousedown = wrapUnsetHover(
      compilePointerListener(tool.listeners.press, false),
    );
    compiled.touchstart = wrapUnsetHover(
      compilePointerListener(tool.listeners.press, true),
    );
  }
  if (tool.listeners.move) {
    compiled.mousemove = compilePointerListener(tool.listeners.move, false);
    compiled.touchmove = compilePointerListener(tool.listeners.move, true);
  }
  if (tool.listeners.release) {
    compiled.mouseup = compilePointerListener(tool.listeners.release, false);
    compiled.mouseleave = compiled.mouseup;
    const touchRelease = compilePointerListener(tool.listeners.release, true);
    compiled.touchleave = touchRelease;
    compiled.touchend = touchRelease;
    compiled.touchcancel = touchRelease;
  }
  tool.compiledListeners = compiled;
  return tool;
}

/**
 * @param {string} toolName
 * @returns {Promise<MountedAppTool | null>}
 */
async function bootToolPromise(toolName) {
  const toolModule = await loadToolModule(toolName);
  const toolState = /** @type {ToolRuntimeState} */ (
    await toolModule.boot(createToolBootContext(toolName))
  );
  return Tools.toolRegistry.mountTool(toolModule, toolState, toolName);
}

/** @param {MountedAppTool} newTool */
function toggleSecondaryTool(newTool) {
  if (!newTool.secondary) return;
  newTool.secondary.active = !newTool.secondary.active;
  const props = newTool.secondary.active ? newTool.secondary : newTool;
  toggleToolButtonMode(newTool.name, props.name, props.icon);
  if (newTool.secondary.switch) newTool.secondary.switch();
  syncActiveToolState();
  Tools.toolRegistry.syncActiveToolInputPolicy();
}

/**
 * @param {string} toolName
 * @param {MountedAppTool} newTool
 * @returns {void}
 */
function updateCurrentToolChrome(toolName, newTool) {
  const dom = getAttachedBoardDom();
  if (!dom) return;
  const curToolName = Tools.toolRegistry.current
    ? Tools.toolRegistry.current.name
    : "";
  try {
    changeActiveToolButton(curToolName, toolName);
  } catch (e) {
    logBoardEvent("error", "tool.chrome_update_failed", {
      toolName,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  dom.svg.style.cursor = newTool.mouseCursor || "auto";
  dom.board.title = Tools.i18n.t(newTool.helpText || "");
}

/** @param {MountedAppTool} newTool */
function replaceCurrentTool(newTool) {
  const currentTool = Tools.toolRegistry.current;
  if (currentTool !== null) {
    Tools.toolRegistry.removeToolListeners(currentTool);
    currentTool.onquit && currentTool.onquit(newTool);
  }
  Tools.toolRegistry.addToolListeners(newTool);
  Tools.toolRegistry.current = newTool;
  syncActiveToolState();
}

function syncActiveToolState() {
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

(() => {
  /**
   * @param {boolean} active
   * @param {KeyboardEvent} evt
   */
  function handleShift(active, evt) {
    if (
      evt.keyCode === 16 &&
      Tools?.toolRegistry.current &&
      Tools.toolRegistry.current.secondary &&
      Tools.toolRegistry.current.secondary.active !== active
    ) {
      Tools.toolRegistry.change(Tools.toolRegistry.current.name);
    }
  }
  window.addEventListener("keydown", handleShift.bind(null, true));
  window.addEventListener("keyup", handleShift.bind(null, false));
})();
