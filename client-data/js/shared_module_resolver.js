/**
 * @param {string} requirePath
 * @param {string} globalName
 * @param {any} [scope]
 * @returns {any}
 */
function resolveSharedModule(requirePath, globalName, scope) {
  if (
    typeof module === "object" &&
    module.exports &&
    typeof require === "function"
  ) {
    return require(requirePath);
  }
  var globalScope =
    scope ||
    (typeof globalThis !== "undefined" ? globalThis : /** @type {any} */ ({}));
  return globalScope[globalName] || null;
}

var sharedModuleResolver = {
  resolveSharedModule: resolveSharedModule,
};

var root = /** @type {typeof globalThis & {
    WBOSharedModuleResolver?: typeof sharedModuleResolver,
  }} */ (typeof globalThis !== "undefined" ? globalThis : this);

root.WBOSharedModuleResolver = sharedModuleResolver;

if (typeof module === "object" && module.exports) {
  module.exports = sharedModuleResolver;
}
