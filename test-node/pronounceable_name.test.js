const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPronounceableName,
  buildRandomBoardName,
} = require("../server/shared/pronounceable_name.mjs");

test("buildPronounceableName stays deterministic for seeded names", () => {
  const seededName = buildPronounceableName("seed", 2, 3);
  assert.equal(buildPronounceableName("seed", 2, 3), seededName);
  assert.match(seededName, /^[a-z]+$/);
});

test("buildRandomBoardName uses the fixed shortest safe word count", () => {
  assert.equal(buildRandomBoardName(Buffer.alloc(64)), "alal-alal-alal-alal");
});
