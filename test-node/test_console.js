/** @param {Console} baseConsole */
function createSilentConsole(baseConsole) {
  return Object.assign({}, baseConsole, {
    log: function () {},
    warn: function () {},
    error: function () {},
    info: function () {},
    debug: function () {},
  });
}

function installTestConsole() {
  if (process.env.WBO_SILENT !== "true") {
    return function restoreConsole() {};
  }

  var previousConsole = global.console;
  global.console = createSilentConsole(previousConsole);
  return function restoreConsole() {
    global.console = previousConsole;
  };
}

/**
 * @param {Partial<Console>} patch
 * @param {() => any} fn
 */
function withConsole(patch, fn) {
  var previousConsole = global.console;
  global.console = Object.assign({}, previousConsole, patch);
  try {
    var result = fn();
    if (result && typeof result.then === "function") {
      return result.finally(function () {
        global.console = previousConsole;
      });
    }
    return result;
  } finally {
    if (!global.console || global.console === previousConsole) {
      global.console = previousConsole;
    }
  }
}

module.exports = {
  createSilentConsole: createSilentConsole,
  installTestConsole: installTestConsole,
  withConsole: withConsole,
};
