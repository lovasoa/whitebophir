const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  BOARD_FILENAME_MAX_BYTES,
  canonicalizeBoardName,
  decodeAndValidateBoardName,
  isValidBoardName,
} = require("../client-data/js/board_name.js");
const {
  boardSvgPath,
  boardSvgBackupPath,
  createTempSvgPath,
  createQuarantineSvgPath,
} = require("../server/persistence/svg_board_paths.mjs");

test("canonicalizeBoardName lowercases, normalizes, and replaces invalid runs", () => {
  assert.equal(canonicalizeBoardName("Refugee Camp 2"), "refugee-camp-2");
  assert.equal(canonicalizeBoardName("Cafe\u0301"), "café");
  assert.equal(canonicalizeBoardName("%%%ТЕСТ%%%"), "тест");
  assert.equal(canonicalizeBoardName(":/?#"), "");
});

test("isValidBoardName only accepts canonical board names", () => {
  assert.equal(isValidBoardName("тест-room"), true);
  assert.equal(isValidBoardName("Тест Room"), false);
  assert.equal(isValidBoardName("foo--bar"), false);
  assert.equal(isValidBoardName(""), false);
});

test("isValidBoardName rejects names that exceed stored filename byte limits", () => {
  assert.equal(isValidBoardName("a".repeat(200)), true);
  assert.equal(isValidBoardName("a".repeat(201)), false);
  assert.equal(isValidBoardName("界".repeat(66)), true);
  assert.equal(isValidBoardName("界".repeat(67)), false);
});

test("accepted board names leave room for generated persistence paths", (t) => {
  t.mock.method(Date, "now", () => Number.MAX_SAFE_INTEGER);
  for (const name of ["a".repeat(200), `${"界".repeat(66)}ab`]) {
    assert.equal(isValidBoardName(name), true);
    const primary = boardSvgPath(name, "/tmp/history");
    const backup = boardSvgBackupPath(name, "/tmp/history");
    const temp = createTempSvgPath(backup);
    const quarantine = createQuarantineSvgPath(primary);
    assert.equal(path.basename(primary), `board-${name}.svg`);
    assert.equal(backup, `${primary}.bak`);
    assert.match(temp.slice(backup.length), /^\.\d+\.\d+\.tmp$/);
    assert.match(quarantine.slice(primary.length), /^\.\d+\.\d+\.quarantine$/);
    for (const file of [primary, backup, temp, quarantine]) {
      const longestFilename = path
        .basename(file)
        .replace(/\.\d+\.\d+\./, `.${Date.now()}.${Number.MAX_SAFE_INTEGER}.`);
      assert.ok(Buffer.byteLength(longestFilename) <= BOARD_FILENAME_MAX_BYTES);
    }
  }
});

test("decodeAndValidateBoardName accepts only canonical encoded names", () => {
  assert.equal(
    decodeAndValidateBoardName(encodeURIComponent("тест-room")),
    "тест-room",
  );
  assert.equal(
    decodeAndValidateBoardName(encodeURIComponent("Тест Room")),
    null,
  );
  assert.equal(decodeAndValidateBoardName("%E0%A4%A"), null);
});
