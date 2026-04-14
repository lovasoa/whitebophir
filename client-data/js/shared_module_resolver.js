import { createRequire } from "node:module";

// @ts-ignore
const nodeRequire = createRequire(import.meta.url);

/**
 * @param {string} requirePath
 * @param {string} globalName
 * @param {any} [scope]
 * @returns {any}
 */
export function resolveSharedModule(requirePath, globalName, scope) {
  if (typeof process !== "undefined" && process.versions?.node) {
    return nodeRequire(requirePath);
  }
  var globalScope =
    scope ||
    (typeof globalThis !== "undefined" ? globalThis : /** @type {any} */ ({}));
  return globalScope[globalName] || null;
}

const sharedModuleResolver = {
  resolveSharedModule: resolveSharedModule,
};
export default sharedModuleResolver;
