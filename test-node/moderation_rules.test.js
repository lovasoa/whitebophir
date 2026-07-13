const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const test = require("node:test");

const RULES_DIR = path.join(__dirname, "..", "client-data", "rules");

test("MODERATION_RULES defines six rules in order with required metadata", async () => {
  const { MODERATION_RULES } = await import(
    "../client-data/js/moderation_rules.js"
  );

  assert.equal(MODERATION_RULES.length, 6);

  const ruleIds = MODERATION_RULES.map((rule) => rule.id);
  assert.deepEqual(ruleIds, [
    "harassment",
    "violence",
    "pornography",
    "illegal",
    "drawings",
    "moderation_decisions",
  ]);

  for (const rule of MODERATION_RULES) {
    assert.ok(typeof rule.id === "string" && rule.id.length > 0);
    assert.ok(
      typeof rule.iconFile === "string" && rule.iconFile.endsWith(".svg"),
    );
    assert.ok(typeof rule.titleKey === "string");
    assert.ok(Array.isArray(rule.bodyKeys) && rule.bodyKeys.length > 0);
    rule.bodyKeys.forEach((key) => assert.ok(typeof key === "string"));
  }

  const decisionsRule = MODERATION_RULES.find(
    (rule) => rule.id === "moderation_decisions",
  );
  assert.ok(decisionsRule);
  assert.equal(
    decisionsRule.appealUrl,
    "https://github.com/lovasoa/whitebophir/discussions",
  );
  assert.equal(decisionsRule.appealLabelKey, "rules_moderation_appeal_link");
});

test("MODERATION_RULE_IDS contains all six rule IDs", async () => {
  const { MODERATION_RULE_IDS, MODERATION_RULES } = await import(
    "../client-data/js/moderation_rules.js"
  );

  assert.equal(MODERATION_RULE_IDS.size, 6);
  for (const rule of MODERATION_RULES) {
    assert.ok(MODERATION_RULE_IDS.has(rule.id));
  }
});

test("getModerationRule returns the correct rule or undefined", async () => {
  const { getModerationRule } = await import(
    "../client-data/js/moderation_rules.js"
  );

  const harassment = getModerationRule("harassment");
  assert.ok(harassment);
  assert.equal(harassment.id, "harassment");
  assert.equal(harassment.iconFile, "no-harassment-personal-attacks.svg");
  assert.equal(harassment.titleKey, "rules_harassment_title");
  assert.deepEqual(harassment.bodyKeys, ["rules_harassment_body"]);

  assert.equal(getModerationRule("not-a-rule"), undefined);
  assert.equal(getModerationRule(""), undefined);
  assert.equal(getModerationRule(undefined), undefined);
});

test("each rule has a corresponding SVG icon file on disk", () => {
  for (const ruleId of [
    "harassment",
    "violence",
    "pornography",
    "illegal",
    "drawings",
    "moderation_decisions",
  ]) {
    const iconFile = {
      harassment: "no-harassment-personal-attacks.svg",
      violence: "no-violence-or-hate-speech.svg",
      pornography: "no-pornography.svg",
      illegal: "no-illegal-content.svg",
      drawings: "respect-other-peoples-drawings.svg",
      moderation_decisions: "respect-moderation-decisions.svg",
    }[ruleId];
    assert.ok(iconFile, `Missing iconFile mapping for ${ruleId}`);
    const iconPath = path.join(RULES_DIR, iconFile);
    assert.ok(fs.existsSync(iconPath), `Missing SVG icon: ${iconFile}`);
  }
});
