const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSilentConsole,
  installTestConsole,
  withConsole,
} = require("./test_console.js");

test("createSilentConsole preserves the console shape while muting noisy methods", () => {
  const silentConsole = createSilentConsole(console);

  assert.equal(typeof silentConsole.warn, "function");
  assert.equal(typeof silentConsole.error, "function");
  assert.equal(typeof silentConsole.trace, typeof console.trace);
  assert.equal(silentConsole.warn("ignored"), undefined);
  assert.equal(silentConsole.error("ignored"), undefined);
});

test("installTestConsole swaps in a silent console only in silent mode", () => {
  const previousSilent = process.env.WBO_SILENT;
  const previousConsole = global.console;

  process.env.WBO_SILENT = "true";
  const restoreConsole = installTestConsole();

  try {
    assert.notEqual(global.console, previousConsole);
    assert.equal(global.console.warn("ignored"), undefined);
  } finally {
    restoreConsole();
    if (previousSilent === undefined) delete process.env.WBO_SILENT;
    else process.env.WBO_SILENT = previousSilent;
  }

  assert.equal(global.console, previousConsole);
});

test("withConsole temporarily patches console methods", () => {
  let warned = false;

  withConsole(
    {
      warn: () => {
        warned = true;
      },
    },
    () => {
      global.console.warn("patched");
    },
  );

  assert.equal(warned, true);
});
