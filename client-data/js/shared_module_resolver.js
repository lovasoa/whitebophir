((root, factory) => {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  /** @type {any} */ (root).WBOSharedModuleResolver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
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
      (typeof globalThis !== "undefined"
        ? globalThis
        : /** @type {any} */ ({}));
    return globalScope[globalName] || null;
  }

  return {
    resolveSharedModule: resolveSharedModule,
  };
});
