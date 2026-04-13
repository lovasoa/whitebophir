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
    return fn();
  } finally {
    global.console = previousConsole;
  }
}

module.exports = {
  createSilentConsole: createSilentConsole,
  installTestConsole: installTestConsole,
  withConsole: withConsole,
};
