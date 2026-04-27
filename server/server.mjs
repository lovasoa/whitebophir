import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as productionConfig from "./configuration.mjs";
import { route, routeHttpRequests } from "./http_dispatch.mjs";
import observability from "./observability.mjs";
import {
  downloadBoard,
  rejectMissingBoardName,
  serveBoardPreview,
  serveBoardSvg,
} from "./board_asset_routes.mjs";
import { redirectBoardQuery, serveBoardPage } from "./board_page_route.mjs";
import { startWhiteboardServer } from "./server_boot.mjs";
import { createServerRuntime } from "./server_runtime.mjs";
import * as sockets from "./sockets.mjs";
import {
  redirectToDefaultBoard,
  redirectToRandomBoard,
  serveBoardStaticAsset,
  serveStaticAsset,
} from "./static_routes.mjs";

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
    route("/download/{board}", downloadBoard, "download_board"),
    route("/download", rejectMissingBoardName, "download_board"),
    route("/download/", rejectMissingBoardName, "download_board"),
    route("/preview/{board}", serveBoardPreview, "preview_board"),
    route("/preview", rejectMissingBoardName, "preview_board"),
    route("/preview/", rejectMissingBoardName, "preview_board"),
    route("/export/{board}", serveBoardPreview, "preview_board", {
      access: "user",
    }),
    route("/export", rejectMissingBoardName, "preview_board", {
      access: "user",
    }),
    route("/export/", rejectMissingBoardName, "preview_board", {
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

export { createServerApp, createWhiteboardHttpHandler };
