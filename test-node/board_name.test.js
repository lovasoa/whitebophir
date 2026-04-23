const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canonicalizeBoardName,
  decodeAndValidateBoardName,
  isValidBoardName,
} = require("../client-data/js/board_name.js");

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
