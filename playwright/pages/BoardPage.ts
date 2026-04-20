import { expect, type Page } from "@playwright/test";
import type {
  AppToolsState,
  BoardMessage,
  MountedAppTool,
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
  awaitingSyncReplay: boolean;
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
        !!window.Tools ||
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
      currentTool: window.Tools?.curTool?.name ?? "",
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
      window.__turnstileOptions = null;
      window.turnstile = {
        render(_: unknown, options: unknown) {
          window.__turnstileOptions =
            options as typeof window.__turnstileOptions;
          return "test-turnstile-widget";
        },
        remove() {},
        reset() {},
      };
    });
  }

  async trackBroadcasts() {
    await this.waitForSocketConnected();
    await this.page.evaluate(() => {
      window.__receivedBroadcasts = [];
      window.Tools.socket?.on("broadcast", (message: BoardMessage) => {
        window.__receivedBroadcasts?.push(message);
      });
    });
  }

  async waitForSocketConnected() {
    await expect
      .poll(() => this.page.evaluate(() => !!window.Tools?.socket?.connected))
      .toBe(true);
  }

  async waitForToolBooted(name: string) {
    await expect
      .poll(() =>
        this.page.evaluate(
          (targetToolName) => !!window.Tools?.list?.[targetToolName],
          name,
        ),
      )
      .toBe(true);
  }

  async waitForBoardWritable() {
    await expect
      .poll(() =>
        this.page.evaluate(() => {
          const tools = window.Tools;
          return !!(
            tools &&
            tools.connectionState === "connected" &&
            tools.awaitingBoardSnapshot === false &&
            typeof tools.isWritePaused === "function" &&
            !tools.isWritePaused()
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
      const socket = window.Tools.socket;
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
              nextId: window.Tools.socket?.id ?? null,
            });
          });
        },
      );
    });
  }

  async drawPencilPaths(paths: PencilPath[]) {
    await this.waitForBoardWritable();
    await this.page.evaluate(async (inputPaths) => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const getTools = () => window.Tools;
      const ensurePencilTool = async () => {
        const tools = getTools();
        if (typeof tools.ensureToolBooted === "function") {
          await tools.ensureToolBooted("Pencil");
        }
        const pencilTool = tools.list.Pencil;
        if (!pencilTool) throw new Error("Missing Pencil tool");
        return { tools, pencilTool };
      };
      const startPencilPath = (
        tools: AppToolsState,
        pencilTool: MountedAppTool,
        path: PencilPath,
      ) => {
        tools.setColor(path.color);
        const lineId = tools.generateUID("l");
        tools.drawAndSend(
          {
            type: "line",
            id: lineId,
            color: path.color,
            size: tools.getSize(),
            opacity: tools.getOpacity(),
          },
          pencilTool,
        );
        return lineId;
      };
      const appendPencilPoint = async (
        tools: AppToolsState,
        pencilTool: MountedAppTool,
        lineId: string,
        point: Point,
      ) => {
        tools.drawAndSend(
          {
            type: "child",
            parent: lineId,
            x: point.x,
            y: point.y,
          },
          pencilTool,
        );
        await nextFrame();
      };

      for (const path of inputPaths) {
        if (path.points.length === 0) continue;
        const { tools, pencilTool } = await ensurePencilTool();
        const lineId = startPencilPath(tools, pencilTool, path);
        await nextFrame();
        for (let index = 0; index < path.points.length; index += 1) {
          const point = path.points[index];
          if (!point) continue;
          await appendPencilPoint(tools, pencilTool, lineId, point);
        }
      }
    }, paths);
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
        const tool = window.Tools.curTool;
        if (!tool) throw new Error("Missing current tool");
        window.Tools.setColor(drawColor);
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
        const tool = window.Tools.curTool;
        if (!tool) throw new Error("Missing current tool");
        const pressEvent = new MouseEvent("mousedown");
        Object.defineProperty(pressEvent, "target", {
          value: window.Tools.board,
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
        const tool = window.Tools.curTool;
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
    await expect(this.page.locator("#drawingArea line")).toHaveCount(1);
    return this.page.evaluate<LineDrawState>(() => {
      const line = document.querySelector("#drawingArea line");
      if (!line) throw new Error("Missing line after draw");
      const currentTool = window.Tools.curTool;
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
        const tool = window.Tools.curTool;
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
      const currentTool = window.Tools.curTool;
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
    await this.page.evaluate((targetId) => {
      const rect = document.getElementById(targetId);
      if (!rect) throw new Error(`Missing shape ${targetId}`);
      const tool = window.Tools.curTool;
      if (!tool) throw new Error("Missing current tool");
      const evt = new MouseEvent("mousedown");
      Object.defineProperty(evt, "target", { value: rect });
      tool.listeners.press?.(110, 110, evt, false);
      tool.listeners.release?.(110, 110, evt, false);
    }, id);
    await expect(this.page.locator(`#${id}`)).toHaveCount(0);
  }

  async moveCursor(color: string, x: number, y: number) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      async ({ cursorColor, cursorX, cursorY }) => {
        const tools = window.Tools;
        if (typeof tools.ensureToolBooted === "function") {
          await tools.ensureToolBooted("Cursor");
        }
        tools.setColor(cursorColor);
        const event = new Event("mousemove");
        Object.defineProperty(event, "pageX", { value: cursorX });
        Object.defineProperty(event, "pageY", { value: cursorY });
        tools.board.dispatchEvent(event);
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
        const tool = window.Tools.curTool;
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
      const currentTool = window.Tools.curTool;
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
      return window.Tools.getScale();
    });
    await this.page.evaluate(({ x, y }) => {
      const tools = window.Tools;
      const tool = tools.curTool;
      if (!tool) throw new Error("Missing current tool");
      const zoomInEvent = {
        preventDefault() {},
        clientY: 100,
        shiftKey: false,
      };
      tool.listeners.press?.(x, y, zoomInEvent as unknown as MouseEvent, false);
      tool.listeners.release?.(
        x,
        y,
        zoomInEvent as unknown as MouseEvent,
        false,
      );
    }, point);
    await this.page.waitForFunction((previousScale) => {
      return window.Tools.getScale() > previousScale;
    }, initialScale);
    const scaleAfterZoomIn = await this.page.evaluate(() => {
      return window.Tools.getScale();
    });
    await this.page.evaluate(({ x, y }) => {
      const tools = window.Tools;
      const tool = tools.curTool;
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
      tool.listeners.release?.(
        x,
        y,
        zoomOutEvent as unknown as MouseEvent,
        false,
      );
    }, point);
    await this.page.waitForFunction((previousScale) => {
      return window.Tools.getScale() < previousScale;
    }, scaleAfterZoomIn);
    const scaleAfterZoomOut = await this.page.evaluate(() => {
      return window.Tools.getScale();
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
    await this.page.evaluate((targetId) => {
      const rect = document.getElementById(targetId);
      if (!rect) throw new Error(`Missing shape ${targetId}`);
      const duplicateId = window.Tools.generateUID(targetId[0] ?? "s");
      window.Tools.drawAndSend({
        _children: [{ type: "copy", id: targetId, newid: duplicateId }],
      });
    }, id);
    await expect(this.page.locator("#drawingArea rect")).toHaveCount(2);
    const afterDuplicate = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll("#drawingArea rect")).map(
        (rect) => rect.id,
      );
    });
    await this.page.evaluate((targetId) => {
      window.Tools.drawAndSend({
        _children: [{ type: "delete", id: targetId }],
      });
    }, id);
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
      window.Tools.socket?.emit("broadcast", data);
    }, message);
  }

  async drawRectangle(color: string, start: Point, end: Point, size = 11) {
    await this.waitForBoardWritable();
    await this.page.evaluate(
      ({ drawColor, drawStart, drawEnd, drawSize }) => {
        window.Tools.setColor(drawColor);
        window.Tools.setSize(drawSize);
        window.Tools.change("Rectangle");
        const tool = window.Tools.curTool;
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
              connected: window.Tools.socket?.connected === true,
              validated: window.Tools.isTurnstileValidated(),
            }),
          );
        };

        window.Tools.socket?.once?.("reconnect", finish);
        window.Tools.socket?.once?.("connect", finish);

        window.Tools.socket?.io?.engine?.close();
      });

      return reconnect;
    });
  }

  async readWriteStatus(): Promise<WriteStatusState> {
    return this.page.evaluate(() => {
      const indicator = document.getElementById("boardStatusIndicator");
      const notice = document.getElementById("boardStatusNotice");
      return {
        connected: !!window.Tools?.socket?.connected,
        bufferedWrites: window.Tools.bufferedWrites.length,
        awaitingBoardSnapshot: !!window.Tools.awaitingBoardSnapshot,
        awaitingSyncReplay: !!window.Tools.awaitingSyncReplay,
        hasAuthoritativeBoardSnapshot:
          !!window.Tools.hasAuthoritativeBoardSnapshot,
        connectionState: String(window.Tools.connectionState ?? ""),
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
      window.Tools.socket?.io?.engine?.close();
    });
  }

  async validateTurnstileToken(token: string) {
    return this.page.evaluate((value) => {
      return new Promise<{ success: boolean; validated: boolean }>(
        (resolve) => {
          window.Tools.socket?.emit(
            "turnstile_token",
            value,
            (result: unknown) => {
              const ack = window.Tools.normalizeTurnstileAck(result);
              if (ack.success) window.Tools.setTurnstileValidation(ack);
              resolve({
                success: ack.success === true,
                validated: window.Tools.isTurnstileValidated(),
              });
            },
          );
        },
      );
    }, token);
  }

  async queueProtectedRectangle(id: string) {
    await this.waitForBoardWritable();
    await this.page.evaluate((rectId) => {
      window.Tools.drawAndSend(
        {
          type: "rect",
          id: rectId,
          x: 10,
          y: 20,
          x2: 40,
          y2: 50,
          color: "#112233",
          size: 4,
          opacity: 1,
        },
        window.Tools.list.Rectangle,
      );

      const options = window.__turnstileOptions;
      if (options?.["before-interactive-callback"]) {
        options["before-interactive-callback"]();
      }
    }, id);
    await this.page.waitForFunction(() => {
      const overlay = document.getElementById("turnstile-overlay");
      return !!(
        overlay && !overlay.classList.contains("turnstile-overlay-hidden")
      );
    });
    return this.page.evaluate<ProtectedWriteState>(() => ({
      overlayPresent: true,
      pendingWrites: window.Tools.turnstilePendingWrites.length,
      validated: window.Tools.isTurnstileValidated(),
    }));
  }

  async completeTurnstileChallenge(
    token: string,
  ): Promise<ProtectedWriteState> {
    await this.page.evaluate((value) => {
      window.__turnstileOptions?.callback?.(value);
    }, token);
    await this.page.waitForFunction(() => {
      const overlay = document.getElementById("turnstile-overlay");
      return !overlay || overlay.classList.contains("turnstile-overlay-hidden");
    });
    return this.page.evaluate<ProtectedWriteState>(() => ({
      overlayPresent: false,
      pendingWrites: window.Tools.turnstilePendingWrites.length,
      validated: window.Tools.isTurnstileValidated(),
    }));
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
