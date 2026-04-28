const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const STATIC_IMPORT_PATTERN =
  /^\s*import\s+(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']|^\s*export\s+[^"']*?from\s+["']([^"']+)["']/gm;

/**
 * @param {string} specifier
 * @param {string} fromFile
 * @returns {string | null}
 */
function resolveLocalModule(specifier, fromFile) {
  if (!specifier.startsWith(".")) return null;
  let resolved = path.resolve(path.dirname(fromFile), specifier);
  if (!path.extname(resolved)) resolved += ".js";
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * @param {string} entry
 * @returns {Set<string>}
 */
function staticImportClosure(entry) {
  const entryPath = path.resolve(ROOT, entry);
  /** @type {Set<string>} */
  const seen = new Set();

  /** @param {string} file */
  function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
      const specifier = match[1] || match[2];
      if (!specifier) continue;
      const imported = resolveLocalModule(specifier, file);
      if (imported) walk(imported);
    }
  }

  walk(entryPath);
  return new Set(Array.from(seen, (file) => path.relative(ROOT, file)));
}

/**
 * @param {Set<string>} closure
 * @param {string[]} forbidden
 */
function assertClosureExcludes(closure, forbidden) {
  const present = forbidden.filter((file) => closure.has(file));
  assert.deepEqual(present, []);
}

test("pan-ready boot graph excludes full app and tool implementations", () => {
  const closure = staticImportClosure("client-data/js/board_main.js");
  assertClosureExcludes(closure, [
    "client-data/js/app_tools.js",
    "client-data/js/board.js",
    "client-data/js/board_access_module.js",
    "client-data/js/board_connection_module.js",
    "client-data/js/board_message_module.js",
    "client-data/js/board_optimistic_module.js",
    "client-data/js/board_presence_module.js",
    "client-data/js/board_replay_module.js",
    "client-data/js/board_shell_module.js",
    "client-data/js/board_status_module.js",
    "client-data/js/board_tool_registry_module.js",
    "client-data/js/board_write_module.js",
    "client-data/js/path-data-polyfill.js",
    "client-data/tools/index.js",
  ]);
  assert.equal(
    Array.from(closure).some((file) =>
      /^client-data\/tools\/[^/]+\/index\.js$/.test(file),
    ),
    false,
  );
});

test("client tool metadata stays independent from tool implementations", () => {
  for (const entry of [
    "client-data/js/message_tool_metadata.js",
    "client-data/js/rate_limit_common.js",
  ]) {
    const closure = staticImportClosure(entry);
    assertClosureExcludes(closure, ["client-data/tools/index.js"]);
    assert.equal(
      Array.from(closure).some((file) =>
        /^client-data\/tools\/[^/]+\/index\.js$/.test(file),
      ),
      false,
      entry,
    );
  }
});
