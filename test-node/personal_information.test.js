const assert = require("node:assert/strict");
const test = require("node:test");

test("personal information warning recognizes common email, phone and street formats", async () => {
  const { mayContainPersonalInformation: matches } = await import(
    "../client-data/tools/text/personal_information.js"
  );
  for (const text of [
    "Email me at alex+board@example.org!",
    "élise@example.fr",
    "Call +1 (202) 555-0147",
    "020 7946 0958",
    "06 12 34 56 78",
    "2025550147",
    "I live at 123 Maple Street",
    "42 W Oak Rd.",
    "12, rue des Lilas",
    "18 avenue Victor Hugo",
    "Hauptstraße 42",
    "10 calle Mayor",
  ]) {
    assert.equal(matches(text), true, text);
    assert.equal(matches(text), true, `repeated detection: ${text}`);
  }
  for (const text of [
    "",
    "Hello world",
    "alex@",
    "alex@example",
    "Meet at 12:30",
    "2026-11-06",
    "12345",
    "1234567890123456",
    "board1234567890name",
    "Main Street",
    "There are 123 apples on the table",
  ]) {
    assert.equal(matches(text), false, text);
  }
});
