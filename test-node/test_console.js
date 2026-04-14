/** @param {Console} baseConsole */
function createSilentConsole(baseConsole) {
  return Object.assign({}, baseConsole, {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
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
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.finally(() => {
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
