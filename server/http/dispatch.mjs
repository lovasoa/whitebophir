import { badRequest } from "./boundary_errors.mjs";
import {
  observeRequest,
  requestErrorStatusCode,
  serveError,
} from "./observation.mjs";
import * as jwtauth from "../auth/jwt.mjs";
import observability from "../observability/index.mjs";
import { validateRequestUrl } from "./request_url.mjs";

const { logger } = observability;

/** @import { HttpRequestHandler, HttpRouteContext, HttpRouteHandler, ServerRuntime } from "../../types/server-runtime.d.ts" */

/**
 * @typedef {{
 *   pattern: string,
 *   routeName: string,
 *   handler: HttpRouteHandler,
 *   access: "none" | "user",
 *   where: ((params: Record<string, string>, url: URL) => boolean) | undefined,
 *   match: (pathname: string) => Record<string, string> | null,
 * }} HttpRoute
 */

/**
 * @param {string} pattern
 * @returns {(pathname: string) => Record<string, string> | null}
 */
function compilePathPattern(pattern) {
  if (pattern === "*") return () => ({});
  /** @type {string[]} */
  const paramNames = [];
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replace(
    /\\\{([A-Za-z][A-Za-z0-9_]*)\\\}/g,
    (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    },
  );
  const regex = new RegExp(`^${source}$`);
  return (pathname) => {
    const match = regex.exec(pathname);
    if (!match) return null;
    /** @type {Record<string, string>} */
    const params = {};
    for (let index = 0; index < paramNames.length; index++) {
      const value = match[index + 1];
      const name = paramNames[index];
      if (name !== undefined && value !== undefined) params[name] = value;
    }
    return params;
  };
}

/**
 * Defines a top-level HTTP route. Access stays explicit so dispatch remains
 * readable from server.mjs.
 *
 * @param {string} pattern
 * @param {HttpRouteHandler} handler
 * @param {string} routeName
 * @param {{access?: "none" | "user", where?: (params: Record<string, string>, url: URL) => boolean}=} options
 * @returns {HttpRoute}
 */
function route(pattern, handler, routeName, options = {}) {
  return {
    pattern,
    handler,
    routeName,
    access: options.access || "none",
    where: options.where,
    match: compilePathPattern(pattern),
  };
}

/**
 * @param {HttpRoute[]} routes
 * @param {URL} url
 * @returns {{route: HttpRoute, params: Record<string, string>}}
 */
function matchHttpRoute(routes, url) {
  for (const route of routes) {
    const params = route.match(url.pathname);
    if (params !== null && (!route.where || route.where(params, url))) {
      return { route, params };
    }
  }
  throw badRequest("no_route_matched");
}

/**
 * Wraps route dispatch with request validation, request-scoped observation,
 * permission checks, error pages, and final metrics/logging.
 *
 * @param {HttpRoute[]} routes
 * @returns {HttpRequestHandler}
 */
function routeHttpRequests(routes) {
  return function handleHttpRequest({ request, response, runtime }) {
    const observed = observeRequest(request, response, runtime.config);
    observed.run(async function dispatchObservedHttpRequest() {
      try {
        const parsedUrlResult = validateRequestUrl(request.url);
        if (parsedUrlResult.ok === false) {
          throw badRequest(parsedUrlResult.reason);
        }
        const url = parsedUrlResult.value;
        const { route, params } = matchHttpRoute(routes, url);
        observed.setRoute(route.routeName);
        if (route.access === "user") {
          jwtauth.checkUserPermission(url, runtime.config);
        }
        await route.handler(
          /** @type {HttpRouteContext} */ ({
            request,
            response,
            runtime,
            observed,
            url,
            params,
          }),
        );
      } catch (error) {
        handleRouteError(error, response, runtime, observed);
      }
    });
  };
}

/**
 * @param {unknown} error
 * @param {import("http").ServerResponse} response
 * @param {ServerRuntime} runtime
 * @param {import("../../types/server-runtime.d.ts").ObservedHttpRequest} observed
 * @returns {void}
 */
function handleRouteError(error, response, runtime, observed) {
  const statusCode = requestErrorStatusCode(error) || 500;
  if (statusCode >= 500) {
    logger.error("http.request_unhandled", {
      request_id: observed.requestId,
      error,
    });
  }
  serveError(response, runtime.errorPage, observed)(error);
}

export { route, routeHttpRequests };
