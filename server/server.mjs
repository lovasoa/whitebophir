import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as productionConfig from "./configuration.mjs";
import { route, routeHttpRequests } from "./http/dispatch.mjs";
import observability from "./observability/index.mjs";
import {
  downloadBoard,
  rejectMissingBoardName,
  serveBoardPreview,
  serveBoardSvg,
} from "./routes/board_assets.mjs";
import { redirectBoardQuery, serveBoardPage } from "./routes/board_page.mjs";
import { startWhiteboardServer } from "./runtime/boot.mjs";
import { createServerRuntime } from "./runtime/create_runtime.mjs";
import * as sockets from "./socket/index.mjs";
import {
  redirectToDefaultBoard,
  redirectToRandomBoard,
  serveBoardStaticAsset,
  serveStaticAsset,
} from "./routes/static.mjs";

const { logger } = observability;

/** @import { ServerConfig, SocketServerModule } from "../types/server-runtime.d.ts" */

/** @param {string | undefined} value */
const hasDot = (value) => typeof value === "string" && value.includes(".");

/**
 * @returns {import("../types/server-runtime.d.ts").HttpRequestHandler}
 */
function createWhiteboardHttpHandler() {
  return routeHttpRequests([
    route("/boards", redirectBoardQuery, "boards_redirect"),
    route("/boards/", rejectMissingBoardName, "board_page"),
    route("/boards/{board}.svg", serveBoardSvg, "board_svg"),
    route("/boards/{asset}", serveBoardStaticAsset, "static_file", {
      where: (params) => hasDot(params.asset),
    }),
    route("/boards/{board}", serveBoardPage, "board_page", {
      where: (params) => !hasDot(params.board),
    }),
    ...boardNameRouteGroup("/download", downloadBoard, "download_board"),
    ...boardNameRouteGroup("/preview", serveBoardPreview, "preview_board"),
    ...boardNameRouteGroup("/export", serveBoardPreview, "preview_board", {
      access: "user",
    }),
    route("/random", redirectToRandomBoard, "random_board", {
      access: "user",
    }),
    route("/", redirectToDefaultBoard, "index", {
      access: "user",
    }),
    route("*", serveStaticAsset, "static_file"),
  ]);
}

/**
 * @param {string} prefix
 * @param {import("../types/server-runtime.d.ts").HttpRouteHandler} handler
 * @param {string} routeName
 * @param {{access?: "none" | "user"}=} options
 */
function boardNameRouteGroup(prefix, handler, routeName, options) {
  return [
    route(`${prefix}/{board}`, handler, routeName, options),
    ...missingBoardNameRoutes(prefix, routeName, options),
  ];
}

/**
 * @param {string} prefix
 * @param {string} routeName
 * @param {{access?: "none" | "user"}=} options
 */
function missingBoardNameRoutes(prefix, routeName, options) {
  return [
    route(prefix, rejectMissingBoardName, routeName, options),
    route(`${prefix}/`, rejectMissingBoardName, routeName, options),
  ];
}

/**
 * @param {ServerConfig} config
 * @param {{
 *   installShutdownHandlers?: boolean,
 *   logStarted?: boolean,
 *   socketsModule?: SocketServerModule,
 * }} [options]
 * @returns {Promise<import("../types/server-runtime.d.ts").ServerApp>}
 */
async function createServerApp(config, options = {}) {
  return startWhiteboardServer(config, {
    runtime: createServerRuntime,
    http: createWhiteboardHttpHandler(),
    sockets: options.socketsModule || sockets,
    installShutdownHandlers: options.installShutdownHandlers,
    logStarted: options.logStarted,
  });
}

const entryArg = process.argv[1];
if (entryArg && path.resolve(entryArg) === fileURLToPath(import.meta.url)) {
  void createServerApp(productionConfig, {
    installShutdownHandlers: true,
  }).catch((error) => {
    logger.error("server.start_failed", {
      error,
    });
    process.exit(1);
  });
}

export { createServerApp };
