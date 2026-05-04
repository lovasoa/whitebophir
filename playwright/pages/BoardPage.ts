import { expect, type Page } from "@playwright/test";
import { MutationType } from "../../client-data/js/mutation_type.js";
import { TOOL_CODE_BY_ID } from "../../client-data/tools/tool-order.js";
import type {
  AppToolsState,
  BoardMessage,
  ToolCode,
} from "../../types/app-runtime";
import { withToken } from "../helpers/boardData";
import { broadcastMessageColor } from "../helpers/broadcastMessage";
import {
  hasStableActiveToolState,
  isAuthoritativeResyncComplete,
  isBufferedWriteDrainComplete,
} from "../helpers/runtime_state.mjs";
import type { TestServer } from "../helpers/testServer";

type Point = { x: number; y: number };
type PencilPath = { color: string; points: Point[] };
type ActiveToolState = {
  tool: string;
  mode: string;
  secondary: boolean;
  currentTool: string;
};
type ConnectedUserState = {
  name: string;
  meta: string;
  isSelf: boolean;
  reportDisabled: boolean;
  color: string;
  dotWidth: string;
};
type ShapeDrawState = {
  secondaryActive: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};
type LineDrawState = {
  secondaryActive: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
type SelectionMoveState = {
  selectorActive: boolean;
  translation: {
    transform: string;
    e: number | undefined;
    f: number | undefined;
  };
};
type DownloadState = {
  clicks: number;
  href: string | null | undefined;
  download: string | null | undefined;
  hasSvgTag: boolean;
  hasRect: boolean;
  hasBoardStyles: boolean;
};
type ReconnectState = { connected: boolean; validated: boolean };
type WriteStatusState = {
  connected: boolean;
  bufferedWrites: number;
  awaitingBoardSnapshot: boolean;
  hasAuthoritativeBoardSnapshot: boolean;
  connectionState: string;
  indicatorClass: string;
  noticeText: string;
};
type ProtectedWriteState = {
  overlayPresent: boolean;
  pendingWrites: number;
  validated: boolean;
};
type CursorState = {
  transform: string | null;
  fill: string | null;
};
type BoardUrlOptions = {
  lang?: string;
  token?: string;
  tokenQuery?: string;
  query?: Record<string, string | boolean | undefined>;
};

export class BoardPage {
  readonly page: Page;
  readonly server: TestServer;

  constructor(page: Page, server: TestServer) {
    this.page = page;
    this.server = server;
  }

  tool(name: string) {
    return this.page.locator(`[id='toolID-${name}']`);
  }

  shape(selector: string) {
    return this.page.locator(selector);
  }

  get menu() {
    return this.page.locator("#menu");
  }

  get settings() {
    return this.page.locator("#settings");
  }

  get connectedUsersToggle() {
    return this.page.locator("#connectedUsersToggle");
  }

  get connectedUsersPanel() {
    return this.page.locator("#connectedUsersPanel");
  }

  get connectedUsersRows() {
    return this.page.locator("#connectedUsersList .connected-user-row");
  }

  get statusIndicator() {
    return this.page.locator("#boardStatusIndicator");
  }

  get statusTitle() {
    return this.page.locator("#boardStatusTitle");
  }

  get statusNotice() {
    return this.page.locator("#boardStatusNotice");
  }

  buildBoardUrl(boardName: string, options: BoardUrlOptions = {}) {
    const query = new URLSearchParams();
    query.set("lang", options.lang ?? "en");
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) query.set(key, String(value));
    }
    const url = `${this.server.serverUrl}/boards/${encodeURIComponent(boardName)}?${query.toString()}`;
    return withToken(
      url,
      options.token,
      options.tokenQuery ?? this.server.tokenQuery,
    );
  }

  buildPreviewUrl(boardName: string, options: BoardUrlOptions = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) query.set(key, String(value));
    }
    const url = `${this.server.serverUrl}/preview/${encodeURIComponent(boardName)}${
      query.size > 0 ? `?${query.toString()}` : ""
    }`;
    return withToken(
      url,
      options.token,
      options.tokenQuery ?? this.server.tokenQuery,
    );
  }

  async gotoBoard(boardName: string, options: BoardUrlOptions = {}) {
    await this.page.goto(this.buildBoardUrl(boardName, options));
    await this.page.waitForFunction(() => {
      if (!document.getElementById("board")) return true;
      const phase = document.documentElement.dataset.boardPhase;
      return phase === "ready" || phase === "error";
    });
  }

  async gotoBoardShell(boardName: string, options: BoardUrlOptions = {}) {
    await this.page.goto(this.buildBoardUrl(boardName, options), {
      waitUntil: "domcontentloaded",
    });
    await this.page.waitForFunction(() => {
      if (!document.getElementById("board")) return false;
      return (
        !!window.WBOApp ||
        document.documentElement.dataset.boardPhase === "error"
      );
    });
  }

  async gotoPreview(boardName: string, options: BoardUrlOptions = {}) {
    await this.page.goto(this.buildPreviewUrl(boardName, options));
  }

  async selectTool(name: string) {
    await this.waitForToolBooted(name);
    await expect(this.tool(name)).toBeVisible();
    await this.tool(name).click();
    await this.expectCurrentTool(name);
  }

  async readActiveToolState(): Promise<ActiveToolState> {
    return this.page.evaluate(() => ({
      tool: document.documentElement.dataset.activeTool ?? "",
      mode: document.documentElement.dataset.activeToolMode ?? "",
      secondary:
        document.documentElement.dataset.activeToolSecondary === "true",
      currentTool: window.WBOApp?.toolRegistry?.current?.name ?? "",
    }));
  }

  async expectCurrentTool(name: string) {
    await expect
      .poll(async () =>
        hasStableActiveToolState(await this.readActiveToolState(), name),
      )
      .toBe(true);
  }

  async setSocketHeaders(headers: Record<string, string>) {
    await this.page.addInitScript((socketHeaders) => {
      window.socketio_extra_headers = socketHeaders;
      window.sessionStorage.setItem(
        "socketio_extra_headers",
        JSON.stringify(socketHeaders),
      );
    }, headers);
  }

  async installTurnstileMock() {
    await this.page.context().addInitScript(() => {
      window.__turnstileMock = {
        callbacks: null,
        complete(token: string) {
          this.callbacks?.callback?.(token);
        },
        fail(errorCode: string) {
          this.callbacks?.["error-callback"]?.(errorCode);
        },
        show() {
          this.callbacks?.["before-interactive-callback"]?.();
        },
      };
    });
    await this.page.route(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
      async (route) => {
        await route.fulfill({
          contentType: "application/javascript",
          body: `
window.turnstile = {
  render: function render(_container, options) {
    window.__turnstileMock.callbacks = options;
    queueMicrotask(function showWidget() {
      window.__turnstileMock.show();
    });
    return "test-turnstile-widget";
  },
  remove: function remove() {},
  reset: function reset() {
    queueMicrotask(function showWidget() {
      window.__turnstileMock.show();
    });
  },
};
          `,
        });
      },
    );
  }

  async trackBroadcasts() {
    await this.waitForSocketConnected();
    await this.page.evaluate(() => {
      window.__receivedBroadcasts = [];
      window.WBOApp.connection.socket?.on(
        "broadcast",
        (message: BoardMessage) => {
          window.__receivedBroadcasts?.push(message);
        },
      );
    });
  }

  async waitForSocketConnected() {
    await expect
      .poll(() =>
        this.page.evaluate(
          () => !!window.WBOApp?.connection?.socket?.connected,
        ),
      )
      .toBe(true);
  }

  async waitForToolBooted(name: string) {
    await expect
      .poll(() =>
        this.page.evaluate(
          (targetToolName) =>
            !!window.WBOApp?.toolRegistry?.mounted?.[targetToolName],
          name,
        ),
      )
      .toBe(true);
  }

  async waitForBoardWritable() {
    await expect
      .poll(() =>
        this.page.evaluate(() => {
          const tools = window.WBOApp;
          return !!(
            tools &&
            tools.connection.state === "connected" &&
            tools.replay.awaitingSnapshot === false &&
            !tools.writes.isWritePaused()
          );
        }),
      )
      .toBe(true);
  }

  async waitForBroadcastColor(color: string) {
    await expect
      .poll(async () => {
        const receivedBroadcasts = await this.page.evaluate(
          () => window.__receivedBroadcasts ?? [],
        );
        return receivedBroadcasts.some(
          (message) => broadcastMessageColor(message) === color,
        );
      })
      .toBe(true);
  }

  async readConnectedUsers(): Promise<ConnectedUserState[]> {
    return this.page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("#connectedUsersList .connected-user-row"),
      ).map((row) => {
        const name = row.querySelector(".connected-user-name");
        const meta = row.querySelector(".connected-user-meta");
        const report = row.querySelector(".connected-user-report");
        const dot = row.querySelector(
          ".connected-user-color",
        ) as HTMLElement | null;
        return {
          name: name?.textContent ?? "",
          meta: meta?.textContent ?? "",
          isSelf: row.classList.contains("connected-user-row-self"),
          reportDisabled: !!(report && (report as HTMLButtonElement).disabled),
          color: dot?.style.backgroundColor ?? "",
          dotWidth: dot?.style.width ?? "",
        };
      });
    });
  }

  async reportFirstRemoteUser() {
    await this.page.evaluate(() => {
      const report = document.querySelector<HTMLButtonElement>(
        "#connectedUsersList .connected-user-row:not(.connected-user-row-self) .connected-user-report",
      );
      if (!report) throw new Error("Missing remote user report button");
      report.click();
    });
  }

  async waitForDisconnectThenReconnect() {
    return this.page.evaluate(async () => {
      const socket = window.WBOApp.connection.socket;
      if (!socket) throw new Error("Missing socket");
      if (!socket.once) throw new Error("Socket does not support once()");
      const socketOnce = socket.once.bind(socket);
      const initialId = socket.id ?? null;
      return new Promise<{ initialId: string | null; nextId: string | null }>(
        (resolve, reject) => {
          let sawDisconnect = false;
          const timeout = setTimeout(
            () =>
              reject(
                new Error("Timed out waiting for disconnect/reconnect cycle"),
              ),
            5_000,
          );

          socketOnce("disconnect", () => {
            sawDisconnect = true;
          });
          socketOnce("connect", () => {
            if (!sawDisconnect) return;
            clearTimeout(timeout);
            resolve({
              initialId,
              nextId: window.WBOApp.connection.socket?.id ?? null,
            });
          });
        },
      );
    });
  }

  async drawPencilPaths(paths: PencilPath[]) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      async ({
        inputPaths,
        pencilToolCode,
        createType,
        appendType,
      }: {
        inputPaths: PencilPath[];
        pencilToolCode: ToolCode;
        createType: number;
        appendType: number;
      }) => {
        const nextFrame = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        const getTools = () => window.WBOApp;
        const ensurePencilTool = async () => {
          const tools = getTools();
          await tools.toolRegistry.bootTool("pencil");
          const pencilTool = tools.toolRegistry.mounted.pencil;
          if (!pencilTool) throw new Error("Missing pencil tool");
          return { tools, pencilTool };
        };
        const startPencilPath = (tools: AppToolsState, path: PencilPath) => {
          tools.preferences.setColor(path.color);
          const lineId = tools.ids.generateUID("l");
          tools.writes.drawAndSend({
            tool: pencilToolCode,
            type: createType,
            id: lineId,
            color: path.color,
            size: tools.preferences.getSize(),
            opacity: tools.preferences.getOpacity(),
          });
          return lineId;
        };
        const appendPencilPoint = async (
          tools: AppToolsState,
          lineId: string,
          point: Point,
        ) => {
          tools.writes.drawAndSend({
            tool: pencilToolCode,
            type: appendType,
            parent: lineId,
            x: point.x,
            y: point.y,
          });
          await nextFrame();
        };

        for (const path of inputPaths) {
          if (path.points.length === 0) continue;
          const { tools } = await ensurePencilTool();
          const lineId = startPencilPath(tools, path);
          await nextFrame();
          for (let index = 0; index < path.points.length; index += 1) {
            const point = path.points[index];
            if (!point) continue;
            await appendPencilPoint(tools, lineId, point);
          }
        }
      },
      {
        inputPaths: paths,
        pencilToolCode: TOOL_CODE_BY_ID.pencil,
        createType: MutationType.CREATE,
        appendType: MutationType.APPEND,
      },
    );
    await this.waitForBufferedWritesDrained();
    for (const path of paths) {
      if (path.points.length === 0) continue;
      await expect(
        this.page.locator(`#drawingArea path[stroke='${path.color}']`),
      ).toBeVisible();
    }
  }

  async drawCircle(color: string, center: Point, radius: number) {
    await this.waitForBoardWritable();
    const circleSelector = `ellipse[cx='${center.x}'][cy='${center.y}'][rx='${radius}'][ry='${radius}'][stroke='${color}']`;
    await this.page.evaluate(
      ({ drawColor, drawCenter, drawRadius }) => {
        const tool = window.WBOApp.toolRegistry.current;
        if (!tool) throw new Error("Missing current tool");
        window.WBOApp.preferences.setColor(drawColor);
        tool.listeners.press?.(
          drawCenter.x + drawRadius,
          drawCenter.y + drawRadius,
          new MouseEvent("mousedown"),
          false,
        );
        const moveEvent = new MouseEvent("mousemove");
        Object.defineProperty(moveEvent, "shiftKey", { value: true });
        tool.listeners.move?.(
          drawCenter.x - drawRadius,
          drawCenter.y - drawRadius,
          moveEvent,
          false,
        );
        tool.listeners.release?.(
          drawCenter.x - drawRadius,
          drawCenter.y - drawRadius,
          new MouseEvent("mouseup"),
          false,
        );
      },
      { drawColor: color, drawCenter: center, drawRadius: radius },
    );
    await expect(this.page.locator(circleSelector)).toBeVisible();
  }

  async createText(x: number, y: number, text: string) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      ({ targetX, targetY, targetText }) => {
        const tool = window.WBOApp.toolRegistry.current;
        if (!tool) throw new Error("Missing current tool");
        const pressEvent = new MouseEvent("mousedown");
        Object.defineProperty(pressEvent, "target", {
          value:
            window.WBOApp.dom.status === "attached"
              ? window.WBOApp.dom.board
              : null,
        });
        tool.listeners.press?.(targetX, targetY, pressEvent, false);
        const input = document.getElementById(
          "textToolInput",
        ) as HTMLInputElement | null;
        if (!input) throw new Error("Text input missing");
        input.value = targetText;
        input.dispatchEvent(new Event("keyup"));
        input.blur();
      },
      { targetX: x, targetY: y, targetText: text },
    );
    await expect(this.page.locator("#drawingArea text")).toHaveText(text);
  }

  async expectTextEditorToCoverText(textSelector = "#drawingArea text") {
    await expect
      .poll(() =>
        this.page.evaluate((selector) => {
          const input = document.getElementById("textToolInput");
          const text = document.querySelector(selector);
          if (!(input instanceof HTMLInputElement)) return false;
          if (!(text instanceof SVGTextElement)) return false;
          const inputRect = input.getBoundingClientRect();
          const textRect = text.getBoundingClientRect();
          return (
            inputRect.width > 0 &&
            inputRect.height > 0 &&
            textRect.width > 0 &&
            textRect.height > 0 &&
            inputRect.left <= textRect.left + 1 &&
            inputRect.top <= textRect.top + 1 &&
            inputRect.right >= textRect.right - 1 &&
            inputRect.bottom >= textRect.bottom - 1
          );
        }, textSelector),
      )
      .toBe(true);
  }

  async drawStraightLine(start: Point, end: Point) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      async ({ lineStart, lineEnd }) => {
        const advanceFrames = async (count: number) => {
          for (let index = 0; index < count; index += 1) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }
        };
        const tool = window.WBOApp.toolRegistry.current;
        if (!tool) throw new Error("Missing current tool");
        const evt = new MouseEvent("mousemove");
        tool.listeners.press?.(lineStart.x, lineStart.y, evt, false);
        await advanceFrames(6);
        tool.listeners.move?.(lineEnd.x, lineEnd.y, evt, false);
        await advanceFrames(1);
        tool.listeners.release?.(lineEnd.x, lineEnd.y, evt, false);
      },
      { lineStart: start, lineEnd: end },
    );
    await expect
      .poll(() =>
        this.page.evaluate(
          () => document.querySelectorAll("#drawingArea line").length,
        ),
      )
      .toBe(1);
    return this.page.evaluate<LineDrawState>(() => {
      const line = document.querySelector("#drawingArea line");
      if (!line) throw new Error("Missing line after draw");
      const currentTool = window.WBOApp.toolRegistry.current;
      if (!currentTool) throw new Error("Missing current tool");
      return {
        secondaryActive: currentTool.secondary?.active === true,
        x1: Number(line.getAttribute("x1")),
        y1: Number(line.getAttribute("y1")),
        x2: Number(line.getAttribute("x2")),
        y2: Number(line.getAttribute("y2")),
      };
    });
  }

  async drawSquare(start: Point, end: Point) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      ({ squareStart, squareEnd }) => {
        const tool = window.WBOApp.toolRegistry.current;
        if (!tool) throw new Error("Missing current tool");
        const evt = new MouseEvent("mousemove");
        tool.listeners.press?.(squareStart.x, squareStart.y, evt, false);
        tool.listeners.move?.(squareEnd.x, squareEnd.y, evt, false);
        tool.listeners.release?.(squareEnd.x, squareEnd.y, evt, false);
      },
      { squareStart: start, squareEnd: end },
    );
    await expect(this.page.locator("#drawingArea rect")).toBeVisible();
    return this.page.evaluate<ShapeDrawState>(() => {
      const rect = document.querySelector("#drawingArea rect");
      if (!rect) throw new Error("Missing rectangle after draw");
      const currentTool = window.WBOApp.toolRegistry.current;
      if (!currentTool) throw new Error("Missing current tool");
      return {
        secondaryActive: currentTool.secondary?.active === true,
        x: Number(rect.getAttribute("x")),
        y: Number(rect.getAttribute("y")),
        width: Number(rect.getAttribute("width")),
        height: Number(rect.getAttribute("height")),
      };
    });
  }

  async eraseShapeById(id: string) {
    await this.waitForBoardWritable();
    const shape = this.page.locator(`#${id}`);
    await this.page.evaluate(
      ({ targetId, deleteType, toolId }) => {
        const tool = window.WBOApp.toolRegistry.current;
        if (!tool || tool.name !== "eraser") {
          throw new Error("Missing eraser tool");
        }
        tool.draw({ type: deleteType, id: targetId }, true);
        window.WBOApp.connection.socket?.emit("broadcast", {
          tool: toolId,
          type: deleteType,
          id: targetId,
        });
      },
      {
        targetId: id,
        deleteType: MutationType.DELETE,
        toolId: TOOL_CODE_BY_ID.eraser,
      },
    );
    await expect(shape).toHaveCount(0);
  }

  async moveCursor(color: string, x: number, y: number) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      async ({ cursorColor, cursorX, cursorY }) => {
        const tools = window.WBOApp;
        await tools.toolRegistry.bootTool("cursor");
        tools.preferences.setColor(cursorColor);
        const event = new Event("mousemove");
        Object.defineProperty(event, "pageX", { value: cursorX });
        Object.defineProperty(event, "pageY", { value: cursorY });
        if (tools.dom.status !== "attached") {
          throw new Error("Board runtime is not attached.");
        }
        tools.dom.board.dispatchEvent(event);
      },
      { cursorColor: color, cursorX: x, cursorY: y },
    );
  }

  async moveSelection(id: string, from: Point, to: Point) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      ({ targetId, fromPoint, toPoint }) => {
        const rect = document.getElementById(targetId);
        if (!rect) throw new Error(`Missing shape ${targetId}`);
        const tool = window.WBOApp.toolRegistry.current;
        if (!tool) throw new Error("Missing current tool");
        const evt = new MouseEvent("mousemove", {
          clientX: 0,
          clientY: 0,
        });
        Object.defineProperty(evt, "target", { value: rect });
        tool.listeners.press?.(fromPoint.x, fromPoint.y, evt, false);
        tool.listeners.move?.(toPoint.x, toPoint.y, evt, false);
        tool.listeners.release?.(toPoint.x, toPoint.y, evt, false);
      },
      { targetId: id, fromPoint: from, toPoint: to },
    );
    await this.page.waitForFunction((targetId) => {
      const rect = document.getElementById(targetId);
      return rect?.getAttribute("transform")?.includes("matrix(") ?? false;
    }, id);
    return this.page.evaluate<SelectionMoveState, string>((targetId) => {
      const rect = document.getElementById(targetId);
      if (!rect) throw new Error(`Missing shape ${targetId}`);
      const transform = rect.getAttribute("transform") ?? "";
      const values = (transform.match(/matrix\(([^)]+)\)/)?.[1] ?? "")
        .split(/[ ,]+/)
        .filter(Boolean)
        .map(Number);
      const currentTool = window.WBOApp.toolRegistry.current;
      if (!currentTool) throw new Error("Missing current tool");
      return {
        selectorActive: currentTool.secondary?.active === true,
        translation: {
          transform,
          e: values[4],
          f: values[5],
        },
      };
    }, id);
  }

  async zoomClickInAndOut(point: Point) {
    const initialScale = await this.page.evaluate(() => {
      return window.WBOApp.viewportState.controller.getScale();
    });
    await this.page.evaluate(({ x, y }) => {
      const tools = window.WBOApp;
      const tool = tools.toolRegistry.current;
      if (!tool) throw new Error("Missing current tool");
      const zoomInEvent = {
        preventDefault() {},
        clientY: 100,
        shiftKey: false,
      };
      tool.listeners.press?.(x, y, zoomInEvent as unknown as MouseEvent, false);
      const release = tool.listeners.release as
        | ((
            x: number,
            y: number,
            evt: MouseEvent,
            isTouchEvent: boolean,
          ) => void)
        | undefined;
      release?.(x, y, zoomInEvent as unknown as MouseEvent, false);
    }, point);
    await this.page.waitForFunction((previousScale) => {
      return window.WBOApp.viewportState.controller.getScale() > previousScale;
    }, initialScale);
    const scaleAfterZoomIn = await this.page.evaluate(() => {
      return window.WBOApp.viewportState.controller.getScale();
    });
    await this.page.evaluate(({ x, y }) => {
      const tools = window.WBOApp;
      const tool = tools.toolRegistry.current;
      if (!tool) throw new Error("Missing current tool");
      const zoomOutEvent = {
        preventDefault() {},
        clientY: 100,
        shiftKey: true,
      };
      tool.listeners.press?.(
        x,
        y,
        zoomOutEvent as unknown as MouseEvent,
        false,
      );
      const release = tool.listeners.release as
        | ((
            x: number,
            y: number,
            evt: MouseEvent,
            isTouchEvent: boolean,
          ) => void)
        | undefined;
      release?.(x, y, zoomOutEvent as unknown as MouseEvent, false);
    }, point);
    await this.page.waitForFunction((previousScale) => {
      return window.WBOApp.viewportState.controller.getScale() < previousScale;
    }, scaleAfterZoomIn);
    const scaleAfterZoomOut = await this.page.evaluate(() => {
      return window.WBOApp.viewportState.controller.getScale();
    });
    return {
      scaleAfterZoomIn,
      scaleAfterZoomOut,
    };
  }

  async installDownloadCapture() {
    await this.page.evaluate(() => {
      window.__downloadCapture = null;
      window.__downloadAnchorClicks = 0;
      window.URL.createObjectURL = (blob: Blob) => {
        window.__downloadBlob = blob;
        return "blob:test-download";
      };
      window.URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function click() {
        window.__downloadAnchorClicks =
          (window.__downloadAnchorClicks ?? 0) + 1;
        window.__downloadCapture = {
          href: this.getAttribute("href"),
          download: this.getAttribute("download"),
        };
      };
    });
  }

  async readDownloadCapture(): Promise<DownloadState> {
    return this.page.evaluate(async () => {
      const blob = window.__downloadBlob;
      if (!blob) throw new Error("Missing captured download blob");
      const text = await blob.text();
      return {
        clicks: window.__downloadAnchorClicks ?? 0,
        href: window.__downloadCapture?.href,
        download: window.__downloadCapture?.download,
        hasSvgTag: text.includes("<svg"),
        hasRect: text.includes('id="download-rect"'),
        hasBoardStyles: text.includes("#drawingArea"),
      };
    });
  }

  async duplicateSelectionAndDelete(id: string) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      ({ handTool, targetId, copyType }) => {
        const rect = document.getElementById(targetId);
        if (!rect) throw new Error(`Missing shape ${targetId}`);
        const duplicateId = window.WBOApp.ids.generateUID(targetId[0] ?? "s");
        window.WBOApp.writes.drawAndSend({
          tool: handTool,
          _children: [{ type: copyType, id: targetId, newid: duplicateId }],
        });
      },
      {
        handTool: TOOL_CODE_BY_ID.hand,
        targetId: id,
        copyType: MutationType.COPY,
      },
    );
    await expect(this.page.locator("#drawingArea rect")).toHaveCount(2);
    const afterDuplicate = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll("#drawingArea rect")).map(
        (rect) => rect.id,
      );
    });
    await this.page.evaluate(
      ({ handTool, targetId, deleteType }) => {
        window.WBOApp.writes.drawAndSend({
          tool: handTool,
          _children: [{ type: deleteType, id: targetId }],
        });
      },
      {
        handTool: TOOL_CODE_BY_ID.hand,
        targetId: id,
        deleteType: MutationType.DELETE,
      },
    );
    await expect(this.page.locator("#drawingArea rect")).toHaveCount(1);
    const afterDelete = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll("#drawingArea rect")).map(
        (rect) => rect.id,
      );
    });
    return { afterDuplicate, afterDelete };
  }

  async emitBroadcast(message: Record<string, unknown>) {
    await this.waitForBoardWritable();
    await this.page.evaluate((data) => {
      window.WBOApp.connection.socket?.emit("broadcast", data);
    }, message);
  }

  async drawRectangle(color: string, start: Point, end: Point, size = 11) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      ({ drawColor, drawStart, drawEnd, drawSize }) => {
        window.WBOApp.preferences.setColor(drawColor);
        window.WBOApp.preferences.setSize(drawSize);
        window.WBOApp.toolRegistry.change("rectangle");
        const tool = window.WBOApp.toolRegistry.current;
        if (!tool) throw new Error("Missing current tool");
        tool.listeners.press?.(
          drawStart.x,
          drawStart.y,
          new MouseEvent("mousedown"),
          false,
        );
        tool.listeners.move?.(
          drawEnd.x,
          drawEnd.y,
          new MouseEvent("mousemove"),
          false,
        );
        tool.listeners.release?.(
          drawEnd.x,
          drawEnd.y,
          new MouseEvent("mouseup"),
          false,
        );
      },
      { drawColor: color, drawStart: start, drawEnd: end, drawSize: size },
    );
  }

  async scrollPosition() {
    return this.page.evaluate(() => ({
      left: window.scrollX || document.documentElement.scrollLeft,
      top: window.scrollY || document.documentElement.scrollTop,
    }));
  }

  async forceScrollTopLeft() {
    await this.page.evaluate(() => {
      window.scrollTo(0, 0);
    });
  }

  async reconnectAndReadState(): Promise<ReconnectState> {
    return this.page.evaluate(async () => {
      const reconnect = await new Promise<{
        connected: boolean;
        validated: boolean;
      }>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for reconnect")),
          5_000,
        );

        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          requestAnimationFrame(() =>
            resolve({
              connected: window.WBOApp.connection.socket?.connected === true,
              validated: window.WBOApp.turnstile.isValidated(),
            }),
          );
        };

        window.WBOApp.connection.socket?.once?.("reconnect", finish);
        window.WBOApp.connection.socket?.once?.("connect", finish);

        window.WBOApp.connection.socket?.io?.engine?.close();
      });

      return reconnect;
    });
  }

  async readWriteStatus(): Promise<WriteStatusState> {
    return this.page.evaluate(() => {
      const indicator = document.getElementById("boardStatusIndicator");
      const notice = document.getElementById("boardStatusNotice");
      return {
        connected: !!window.WBOApp?.connection?.socket?.connected,
        bufferedWrites: window.WBOApp.writes.bufferedWrites.length,
        awaitingBoardSnapshot: !!window.WBOApp.replay.awaitingSnapshot,
        hasAuthoritativeBoardSnapshot:
          !!window.WBOApp.replay.hasAuthoritativeSnapshot,
        connectionState: String(window.WBOApp.connection.state ?? ""),
        indicatorClass: indicator?.className ?? "",
        noticeText: notice?.textContent ?? "",
      };
    });
  }

  async waitForBufferedWritesDrained() {
    await expect
      .poll(async () =>
        isBufferedWriteDrainComplete(await this.readWriteStatus()),
      )
      .toBe(true);
  }

  async waitForAuthoritativeResync() {
    await expect
      .poll(async () =>
        isAuthoritativeResyncComplete(await this.readWriteStatus()),
      )
      .toBe(true);
  }

  async forceSocketDisconnect() {
    await this.page.evaluate(() => {
      window.WBOApp.connection.socket?.io?.engine?.close();
    });
  }

  async validateTurnstileToken(token: string) {
    return this.page.evaluate((value) => {
      return new Promise<{ success: boolean; validated: boolean }>(
        (resolve) => {
          window.WBOApp.connection.socket?.emit(
            "turnstile_token",
            value,
            (result: unknown) => {
              const ack = window.WBOApp.turnstile.normalizeAck(result);
              if (ack.success) window.WBOApp.turnstile.setValidation(ack);
              resolve({
                success: ack.success === true,
                validated: window.WBOApp.turnstile.isValidated(),
              });
            },
          );
        },
      );
    }, token);
  }

  async queueProtectedRectangle(id: string) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      ({ rectangleTool, rectId, createType }) => {
        window.WBOApp.writes.drawAndSend({
          tool: rectangleTool,
          type: createType,
          id: rectId,
          x: 10,
          y: 20,
          x2: 40,
          y2: 50,
          color: "#112233",
          size: 10,
          opacity: 1,
        });
      },
      {
        rectangleTool: TOOL_CODE_BY_ID.rectangle,
        rectId: id,
        createType: MutationType.CREATE,
      },
    );
    await this.page.waitForFunction(() => {
      const overlay = document.getElementById("turnstile-overlay");
      return !!(
        overlay && !overlay.classList.contains("turnstile-overlay-hidden")
      );
    });
    return this.page.evaluate<ProtectedWriteState>(() => ({
      overlayPresent: true,
      pendingWrites: window.WBOApp.turnstile.pendingWrites.length,
      validated: window.WBOApp.turnstile.isValidated(),
    }));
  }

  async completeTurnstileChallenge(
    token: string,
  ): Promise<ProtectedWriteState> {
    await this.page.evaluate((value) => {
      window.__turnstileMock.complete(value);
    }, token);
    await this.page.waitForFunction(() => {
      const overlay = document.getElementById("turnstile-overlay");
      return !overlay || overlay.classList.contains("turnstile-overlay-hidden");
    });
    return this.page.evaluate<ProtectedWriteState>(() => ({
      overlayPresent: false,
      pendingWrites: window.WBOApp.turnstile.pendingWrites.length,
      validated: window.WBOApp.turnstile.isValidated(),
    }));
  }

  async failTurnstileChallenge(
    errorCode: string,
  ): Promise<ProtectedWriteState> {
    await this.page.evaluate((value) => {
      window.__turnstileMock.fail(value);
    }, errorCode);
    return this.page.evaluate<ProtectedWriteState>(() => {
      const overlay = document.getElementById("turnstile-overlay");
      return {
        overlayPresent: !!(
          overlay && !overlay.classList.contains("turnstile-overlay-hidden")
        ),
        pendingWrites: window.WBOApp.turnstile.pendingWrites.length,
        validated: window.WBOApp.turnstile.isValidated(),
      };
    });
  }

  async readCursorAttributes(): Promise<CursorState | null> {
    return this.page.evaluate<CursorState | null>(() => {
      const cursor = document.getElementById("cursor-me");
      if (!(cursor instanceof SVGElement)) return null;
      const style =
        cursor.style.transform || window.getComputedStyle(cursor).transform;
      return {
        transform: style || cursor.getAttribute("transform"),
        fill: cursor.getAttribute("fill"),
      };
    });
  }
}
