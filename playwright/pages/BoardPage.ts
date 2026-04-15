import { expect, type Locator, type Page } from "@playwright/test";
import { withToken } from "../helpers/boardData";
import type { TestServer } from "../helpers/testServer";

type Point = { x: number; y: number };
type PencilPath = { color: string; points: Point[] };
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
      const state = document.documentElement.dataset.boardReady;
      return state === "true" || state === "error";
    });
  }

  async gotoPreview(boardName: string, options: BoardUrlOptions = {}) {
    await this.page.goto(this.buildPreviewUrl(boardName, options));
  }

  async selectTool(name: string) {
    await this.tool(name).click();
  }

  async expectCurrentTool(name: string) {
    await expect(this.tool(name)).toHaveClass(/curTool/);
  }

  async setSocketHeaders(headers: Record<string, string>) {
    await this.page.addInitScript((socketHeaders) => {
      (window as any).socketio_extra_headers = socketHeaders;
      window.sessionStorage.setItem(
        "socketio_extra_headers",
        JSON.stringify(socketHeaders),
      );
    }, headers);
  }

  async installTurnstileMock() {
    await this.page.context().addInitScript(() => {
      (window as any).__turnstileOptions = null;
      (window as any).turnstile = {
        render(_: unknown, options: unknown) {
          (window as any).__turnstileOptions = options;
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
      (window as any).__receivedBroadcasts = [];
      (window as any).Tools.socket.on("broadcast", (message: unknown) => {
        (window as any).__receivedBroadcasts.push(message);
      });
    });
  }

  async waitForSocketConnected() {
    await expect
      .poll(() =>
        this.page.evaluate(() => !!(window as any).Tools?.socket?.connected),
      )
      .toBe(true);
  }

  async waitForBroadcastColor(color: string) {
    await expect
      .poll(() =>
        this.page.evaluate((targetColor) => {
          return ((window as any).__receivedBroadcasts ?? []).some(
            (message: { color?: string }) => message?.color === targetColor,
          );
        }, color),
      )
      .toBe(true);
  }

  async readConnectedUsers() {
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
      const socket = (window as any).Tools.socket;
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

          socket.once("disconnect", () => {
            sawDisconnect = true;
          });
          socket.once("connect", () => {
            if (!sawDisconnect) return;
            clearTimeout(timeout);
            resolve({
              initialId,
              nextId: (window as any).Tools.socket.id ?? null,
            });
          });
        },
      );
    });
  }

  async drawPencilPaths(paths: PencilPath[]) {
    await this.page.evaluate(async (inputPaths) => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const waitFor = async (predicate: () => boolean, timeoutMs = 2_000) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          if (predicate()) return;
          await nextFrame();
        }
        throw new Error("Timed out waiting for pencil path");
      };

      for (const path of inputPaths) {
        if (path.points.length === 0) continue;
        (window as any).Tools.setColor(path.color);
        const pencilTool = (window as any).Tools.list.Pencil;
        if (!pencilTool) throw new Error("Missing Pencil tool");
        const lineId = (window as any).Tools.generateUID("l");
        (window as any).Tools.drawAndSend(
          {
            type: "line",
            id: lineId,
            color: path.color,
            size: (window as any).Tools.getSize(),
            opacity: (window as any).Tools.getOpacity(),
          },
          pencilTool,
        );
        await nextFrame();
        for (let index = 0; index < path.points.length; index += 1) {
          const point = path.points[index];
          if (!point) continue;
          (window as any).Tools.drawAndSend(
            {
              type: "child",
              parent: lineId,
              x: point.x,
              y: point.y,
            },
            pencilTool,
          );
          await nextFrame();
        }
        await waitFor(
          () =>
            !!document.querySelector(
              `#drawingArea path[stroke='${path.color}']`,
            ),
        );
      }
    }, paths);
  }

  async drawCircle(color: string, center: Point, radius: number) {
    await this.page.evaluate(
      async ({ drawColor, drawCenter, drawRadius }) => {
        const waitFor = async (predicate: () => boolean, timeoutMs = 2_000) => {
          const deadline = performance.now() + timeoutMs;
          while (performance.now() < deadline) {
            if (predicate()) return;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }
          throw new Error("Timed out waiting for circle");
        };

        (window as any).Tools.setColor(drawColor);
        (window as any).Tools.curTool.listeners.press(
          drawCenter.x + drawRadius,
          drawCenter.y + drawRadius,
          new Event("mousedown"),
        );
        const moveEvent = new Event("mousemove");
        Object.defineProperty(moveEvent, "shiftKey", { value: true });
        (window as any).Tools.curTool.listeners.move(
          drawCenter.x - drawRadius,
          drawCenter.y - drawRadius,
          moveEvent,
        );
        (window as any).Tools.curTool.listeners.release(
          drawCenter.x - drawRadius,
          drawCenter.y - drawRadius,
          new Event("mouseup"),
        );

        await waitFor(
          () =>
            !!document.querySelector(
              `ellipse[cx='${drawCenter.x}'][cy='${drawCenter.y}'][rx='${drawRadius}'][ry='${drawRadius}']`,
            ),
        );
      },
      { drawColor: color, drawCenter: center, drawRadius: radius },
    );
  }

  async createText(x: number, y: number, text: string) {
    await this.page.evaluate(
      async ({ targetX, targetY, targetText }) => {
        const waitFor = async (predicate: () => boolean, timeoutMs = 2_000) => {
          const deadline = performance.now() + timeoutMs;
          while (performance.now() < deadline) {
            if (predicate()) return;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }
          throw new Error("Timed out waiting for text");
        };

        (window as any).Tools.curTool.listeners.press(targetX, targetY, {
          target: (window as any).Tools.board,
          preventDefault() {},
        });
        const input = document.getElementById(
          "textToolInput",
        ) as HTMLInputElement | null;
        if (!input) throw new Error("Text input missing");
        input.value = targetText;
        input.dispatchEvent(new Event("keyup"));
        input.blur();
        await waitFor(() => {
          const node = document.querySelector("#drawingArea text");
          return node?.textContent === targetText;
        });
      },
      { targetX: x, targetY: y, targetText: text },
    );
  }

  async drawStraightLine(start: Point, end: Point) {
    return this.page.evaluate(
      async ({ lineStart, lineEnd }) => {
        const advanceFrames = async (count: number) => {
          for (let index = 0; index < count; index += 1) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }
        };
        const waitFor = async <T>(
          predicate: () => T | null,
          timeoutMs = 2_000,
        ) => {
          const deadline = performance.now() + timeoutMs;
          while (performance.now() < deadline) {
            const value = predicate();
            if (value !== null) return value;
            await advanceFrames(1);
          }
          throw new Error("Timed out waiting for line");
        };

        const evt = { preventDefault() {} };
        (window as any).Tools.curTool.listeners.press(
          lineStart.x,
          lineStart.y,
          evt,
        );
        await advanceFrames(6);
        (window as any).Tools.curTool.listeners.move(lineEnd.x, lineEnd.y, evt);
        await advanceFrames(1);
        (window as any).Tools.curTool.listeners.release(
          lineEnd.x,
          lineEnd.y,
          evt,
        );

        return waitFor(() => {
          const line = document.querySelector("#drawingArea line");
          if (!line) return null;
          return {
            secondaryActive: (window as any).Tools.curTool.secondary.active,
            x1: Number(line.getAttribute("x1")),
            y1: Number(line.getAttribute("y1")),
            x2: Number(line.getAttribute("x2")),
            y2: Number(line.getAttribute("y2")),
          };
        });
      },
      { lineStart: start, lineEnd: end },
    );
  }

  async drawSquare(start: Point, end: Point) {
    return this.page.evaluate(
      async ({ squareStart, squareEnd }) => {
        const waitFor = async <T>(
          predicate: () => T | null,
          timeoutMs = 2_000,
        ) => {
          const deadline = performance.now() + timeoutMs;
          while (performance.now() < deadline) {
            const value = predicate();
            if (value !== null) return value;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }
          throw new Error("Timed out waiting for rectangle");
        };

        const evt = { preventDefault() {} };
        (window as any).Tools.curTool.listeners.press(
          squareStart.x,
          squareStart.y,
          evt,
        );
        (window as any).Tools.curTool.listeners.move(
          squareEnd.x,
          squareEnd.y,
          evt,
        );
        (window as any).Tools.curTool.listeners.release(
          squareEnd.x,
          squareEnd.y,
          evt,
        );

        return waitFor(() => {
          const rect = document.querySelector("#drawingArea rect");
          if (!rect) return null;
          return {
            secondaryActive: (window as any).Tools.curTool.secondary.active,
            x: Number(rect.getAttribute("x")),
            y: Number(rect.getAttribute("y")),
            width: Number(rect.getAttribute("width")),
            height: Number(rect.getAttribute("height")),
          };
        });
      },
      { squareStart: start, squareEnd: end },
    );
  }

  async eraseShapeById(id: string) {
    return this.page.evaluate(async (targetId) => {
      const waitFor = async (predicate: () => boolean, timeoutMs = 2_000) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          if (predicate()) return;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        throw new Error("Timed out waiting for eraser");
      };

      const rect = document.getElementById(targetId);
      if (!rect) throw new Error(`Missing shape ${targetId}`);
      const evt = {
        preventDefault() {},
        target: rect,
      };
      (window as any).Tools.curTool.listeners.press(110, 110, evt);
      (window as any).Tools.curTool.listeners.release(110, 110, evt);
      await waitFor(() => document.getElementById(targetId) === null);
    }, id);
  }

  async moveCursor(color: string, x: number, y: number) {
    await this.page.evaluate(
      ({ cursorColor, cursorX, cursorY }) => {
        (window as any).Tools.setColor(cursorColor);
        const event = new Event("mousemove");
        Object.defineProperty(event, "pageX", { value: cursorX });
        Object.defineProperty(event, "pageY", { value: cursorY });
        (window as any).Tools.board.dispatchEvent(event);
      },
      { cursorColor: color, cursorX: x, cursorY: y },
    );
  }

  async moveSelection(id: string, from: Point, to: Point) {
    return this.page.evaluate(
      async ({ targetId, fromPoint, toPoint }) => {
        const readTranslation = (rect: Element) => {
          const transform = rect.getAttribute("transform") ?? "";
          const values = (transform.match(/matrix\(([^)]+)\)/)?.[1] ?? "")
            .split(/[ ,]+/)
            .filter(Boolean)
            .map(Number);
          return {
            transform,
            e: values[4],
            f: values[5],
          };
        };
        const waitFor = async <T>(
          predicate: () => T | null,
          timeoutMs = 2_000,
        ) => {
          const deadline = performance.now() + timeoutMs;
          while (performance.now() < deadline) {
            const value = predicate();
            if (value !== null) return value;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }
          throw new Error("Timed out waiting for selection");
        };

        const rect = document.getElementById(targetId);
        if (!rect) throw new Error(`Missing shape ${targetId}`);
        const evt = {
          preventDefault() {},
          target: rect,
          clientX: 0,
          clientY: 0,
        };
        (window as any).Tools.curTool.listeners.press(
          fromPoint.x,
          fromPoint.y,
          evt,
        );
        (window as any).Tools.curTool.listeners.move(toPoint.x, toPoint.y, evt);
        (window as any).Tools.curTool.listeners.release(
          toPoint.x,
          toPoint.y,
          evt,
        );
        return waitFor(() => {
          const translation = readTranslation(rect);
          if (translation.e === undefined || translation.f === undefined)
            return null;
          return {
            selectorActive: (window as any).Tools.curTool.secondary.active,
            translation,
          };
        });
      },
      { targetId: id, fromPoint: from, toPoint: to },
    );
  }

  async zoomClickInAndOut(point: Point) {
    return this.page.evaluate(async ({ x, y }) => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const zoomInEvent = {
        preventDefault() {},
        clientY: 100,
        shiftKey: false,
      };
      (window as any).Tools.curTool.listeners.press(x, y, zoomInEvent);
      (window as any).Tools.curTool.listeners.release(x, y, zoomInEvent);
      await nextFrame();
      const scaleAfterZoomIn = (window as any).Tools.getScale();

      const zoomOutEvent = {
        preventDefault() {},
        clientY: 100,
        shiftKey: true,
      };
      (window as any).Tools.curTool.listeners.press(x, y, zoomOutEvent);
      (window as any).Tools.curTool.listeners.release(x, y, zoomOutEvent);
      await nextFrame();

      return {
        scaleAfterZoomIn,
        scaleAfterZoomOut: (window as any).Tools.getScale(),
      };
    }, point);
  }

  async verifyZoomThresholdBehavior() {
    return this.page.evaluate(async () => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const originalShouldDisableTool = (window as any).Tools.shouldDisableTool;
      const originalCanUseTool = (window as any).Tools.canUseTool;

      (window as any).Tools.setScale(0.4);
      const initialState = {
        currentTool: (window as any).Tools.curTool?.name,
        pencilDisabled: document
          .getElementById("toolID-Pencil")
          ?.classList.contains("disabledTool"),
        rectDisabled: document
          .getElementById("toolID-Rectangle")
          ?.classList.contains("disabledTool"),
      };

      const rectangleTool = (window as any).Tools.list.Rectangle;
      const rectToolElem = document.getElementById("toolID-Rectangle");
      if (!rectToolElem) throw new Error("Rectangle tool missing");
      rectToolElem.classList.remove("disabledTool");
      rectToolElem.setAttribute("aria-disabled", "false");
      (window as any).Tools.shouldDisableTool = () => false;
      (window as any).Tools.canUseTool = () => true;

      const evt = { preventDefault() {} };
      const changeResult = (window as any).Tools.change("Rectangle");
      rectangleTool.listeners.press(10, 10, evt);
      rectangleTool.listeners.move(4015, 30, evt);
      rectangleTool.listeners.release(4015, 30, evt);
      await nextFrame();

      const giantShapeState = {
        currentTool: (window as any).Tools.curTool?.name,
        changeResult,
        rectPresent: !!document.querySelector("#drawingArea rect"),
      };

      (window as any).Tools.shouldDisableTool = originalShouldDisableTool;
      (window as any).Tools.canUseTool = originalCanUseTool;

      const blockedChangeResult = (window as any).Tools.change("Pencil");
      (window as any).Tools.setScale(0.5);
      const finalState = {
        currentTool: (window as any).Tools.curTool?.name,
        blockedChangeResult,
        pencilDisabled: document
          .getElementById("toolID-Pencil")
          ?.classList.contains("disabledTool"),
      };

      return { initialState, giantShapeState, finalState };
    });
  }

  async installDownloadCapture() {
    await this.page.evaluate(() => {
      (window as any).__downloadCapture = null;
      (window as any).__downloadAnchorClicks = 0;
      (window as any).URL.createObjectURL = (blob: Blob) => {
        (window as any).__downloadBlob = blob;
        return "blob:test-download";
      };
      (window as any).URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function click() {
        (window as any).__downloadAnchorClicks += 1;
        (window as any).__downloadCapture = {
          href: this.getAttribute("href"),
          download: this.getAttribute("download"),
        };
      };
    });
  }

  async readDownloadCapture() {
    return this.page.evaluate(async () => {
      const text = await (window as any).__downloadBlob.text();
      return {
        clicks: (window as any).__downloadAnchorClicks,
        href: (window as any).__downloadCapture?.href,
        download: (window as any).__downloadCapture?.download,
        hasSvgTag: text.includes("<svg"),
        hasRect: text.includes('id="download-rect"'),
        hasBoardStyles: text.includes("#drawingArea"),
      };
    });
  }

  async duplicateSelectionAndDelete(id: string) {
    return this.page.evaluate(async (targetId) => {
      const rectState = () =>
        Array.from(document.querySelectorAll("#drawingArea rect")).map(
          (rect) => rect.id,
        );
      const waitFor = async <T>(
        predicate: () => T | null,
        timeoutMs = 2_000,
      ) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          const value = predicate();
          if (value !== null) return value;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        throw new Error("Timed out waiting for selector");
      };
      const rect = document.getElementById(targetId);
      if (!rect) throw new Error(`Missing shape ${targetId}`);
      const duplicateId = (window as any).Tools.generateUID(targetId[0] ?? "s");
      (window as any).Tools.drawAndSend({
        _children: [{ type: "copy", id: targetId, newid: duplicateId }],
      });

      const afterDuplicate = await waitFor(() => {
        const ids = rectState();
        return ids.length === 2 ? ids : null;
      });

      (window as any).Tools.drawAndSend({
        _children: [{ type: "delete", id: targetId }],
      });

      const afterDelete = await waitFor(() => {
        const ids = rectState();
        return ids.length === 1 ? ids : null;
      });

      return { afterDuplicate, afterDelete };
    }, id);
  }

  async emitBroadcast(message: Record<string, unknown>) {
    await this.page.evaluate((data) => {
      (window as any).Tools.socket.emit("broadcast", {
        board: (window as any).Tools.boardName,
        data,
      });
    }, message);
  }

  async drawRectangle(color: string, start: Point, end: Point, size = 11) {
    await this.page.evaluate(
      ({ drawColor, drawStart, drawEnd, drawSize }) => {
        (window as any).Tools.setColor(drawColor);
        (window as any).Tools.setSize(drawSize);
        (window as any).Tools.change("Rectangle");
        (window as any).Tools.curTool.listeners.press(
          drawStart.x,
          drawStart.y,
          new Event("mousedown"),
        );
        (window as any).Tools.curTool.listeners.move(
          drawEnd.x,
          drawEnd.y,
          new Event("mousemove"),
        );
        (window as any).Tools.curTool.listeners.release(
          drawEnd.x,
          drawEnd.y,
          new Event("mouseup"),
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

  async reconnectAndReadState() {
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
              connected: (window as any).Tools.socket.connected,
              validated: (window as any).Tools.isTurnstileValidated(),
            }),
          );
        };

        (window as any).Tools.socket.once("reconnect", finish);
        (window as any).Tools.socket.once("connect", finish);

        (window as any).Tools.socket.io.engine.close();
      });

      return reconnect;
    });
  }

  async readWriteStatus() {
    return this.page.evaluate(() => {
      const indicator = document.getElementById("boardStatusIndicator");
      const notice = document.getElementById("boardStatusNotice");
      return {
        bufferedWrites: ((window as any).Tools.bufferedWrites ?? []).length,
        awaitingBoardSnapshot: !!(window as any).Tools.awaitingBoardSnapshot,
        connectionState: String((window as any).Tools.connectionState ?? ""),
        indicatorClass: indicator?.className ?? "",
        noticeText: notice?.textContent ?? "",
      };
    });
  }

  async waitForAuthoritativeResync() {
    await expect
      .poll(() =>
        this.page.evaluate(() => ({
          connected: !!(window as any).Tools?.socket?.connected,
          awaitingBoardSnapshot: !!(window as any).Tools.awaitingBoardSnapshot,
        })),
      )
      .toEqual({
        connected: true,
        awaitingBoardSnapshot: false,
      });
  }

  async forceSocketDisconnect() {
    await this.page.evaluate(() => {
      (window as any).Tools.socket.io.engine.close();
    });
  }

  async validateTurnstileToken(token: string) {
    return this.page.evaluate((value) => {
      return new Promise<{ success: boolean; validated: boolean }>(
        (resolve) => {
          (window as any).Tools.socket.emit(
            "turnstile_token",
            value,
            (result: unknown) => {
              const ack = (window as any).Tools.normalizeTurnstileAck(result);
              if (ack.success)
                (window as any).Tools.setTurnstileValidation(ack);
              resolve({
                success: ack.success === true,
                validated: (window as any).Tools.isTurnstileValidated(),
              });
            },
          );
        },
      );
    }, token);
  }

  async queueProtectedRectangle(id: string) {
    return this.page.evaluate(async (rectId) => {
      const waitFor = async <T>(
        predicate: () => T | null,
        timeoutMs = 2_000,
      ) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          const value = predicate();
          if (value !== null) return value;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        throw new Error("Timed out waiting for turnstile overlay");
      };

      (window as any).Tools.drawAndSend(
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
        (window as any).Tools.list.Rectangle,
      );

      const options = (window as any).__turnstileOptions;
      if (options?.["before-interactive-callback"]) {
        options["before-interactive-callback"]();
      }

      return waitFor(() => {
        const overlay = document.getElementById("turnstile-overlay");
        if (
          !overlay ||
          overlay.classList.contains("turnstile-overlay-hidden")
        ) {
          return null;
        }
        return {
          overlayPresent: true,
          pendingWrites: (window as any).Tools.turnstilePendingWrites.length,
          validated: (window as any).Tools.isTurnstileValidated(),
        };
      });
    }, id);
  }

  async completeTurnstileChallenge(token: string) {
    return this.page.evaluate(async (value) => {
      const waitFor = async <T>(
        predicate: () => T | null,
        timeoutMs = 2_000,
      ) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          const out = predicate();
          if (out !== null) return out;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        throw new Error("Timed out waiting for challenge recovery");
      };

      (window as any).__turnstileOptions.callback(value);
      return waitFor(() => {
        const overlay = document.getElementById("turnstile-overlay");
        if (
          overlay &&
          !overlay.classList.contains("turnstile-overlay-hidden")
        ) {
          return null;
        }
        return {
          overlayPresent: false,
          pendingWrites: (window as any).Tools.turnstilePendingWrites.length,
          validated: (window as any).Tools.isTurnstileValidated(),
        };
      });
    }, token);
  }

  async readCursorAttributes() {
    return this.page.evaluate(() => {
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
