const assert = require("node:assert/strict");
const test = require("node:test");

// Detect regressions in each heuristic, normalization, category precedence and
// repeated calls (phone matching uses a global regular expression).
test("private info detection identifies multilingual contact information", async () => {
  const { privateInfoKind } = await import(
    "../client-data/tools/text/personal_information.js"
  );
  const examples = {
    email: [
      "Email me at alex+board@example.org!",
      "élise@example.fr",
      "ＡＬＥＸ＠ＥＸＡＭＰＬＥ．ＯＲＧ",
      "al\u200bex@exam\u200dple.org",
      "alex@example.org phone +1 (202) 555-0147",
    ],
    contact: [
      "https://t.me/alex_board",
      "wa.me/12025550147",
      "discord.gg/abc123",
      "instagram.com/alex.board",
      "snapchat.com/add/alex",
      "скинь номер",
      "дай тг",
      "напиши в телеграм",
      "давай в дискорд",
      "тг: @alex_board",
      "line：alex123",
      "send your phone number",
      "discord please add me",
      "dammi il numero",
      "manda whatsapp",
      "donne ton numéro",
      "给我微信",
      "交換ライン",
      "電話番号を教えて",
    ],
    address: [
      "I live at 123 Maple Street",
      "42 W Oak Rd.",
      "12 rue des Lilas",
      "18 avenue Victor Hugo",
      "10 calle Mayor",
      "via Roma 12",
      "вул. Шевченка 12",
      "улица Ленина 5",
      "мій домашній адрес",
      "my address",
      "mon adresse",
      "meu endereço",
      "mio indirizzo",
      "中山路123號",
      "桜町3丁目12",
    ],
    phone: [
      "Call +1 (202) 555-0147",
      "020 7946 0958",
      "06 12 34 56 78",
      "+380 67 123 45 67",
      "380671234567",
      "79161234567",
      "3123456789",
      "phone 5550123",
      "telefono 2025550147",
      "+１（２０２）５５５－０１４７",
    ],
  };
  for (const [kind, texts] of Object.entries(examples)) {
    for (const text of texts) {
      assert.equal(privateInfoKind(text), kind, text);
      assert.equal(privateInfoKind(text), kind, `repeated detection: ${text}`);
    }
  }
});

test("private info detection ignores dates, unlabelled numbers and ordinary conversation", async () => {
  const { privateInfoKind } = await import(
    "../client-data/tools/text/personal_information.js"
  );
  for (const text of [
    "",
    "Hello world",
    "alex@",
    "alex@example",
    "Meet at 12:30",
    "2026-11-06",
    "2026.11.06",
    "2026-11-06 12",
    "2026 11 06",
    "12345",
    "1234567",
    "2025550147",
    "1234567890123456",
    "Main Street",
    "There are 123 apples on the table",
    "send a drawing",
    "a phone is useful",
    "telegram is an app",
    "write via telegram",
    "travel via Roma",
    "midnight is quiet",
  ]) {
    assert.equal(privateInfoKind(text), null, text);
  }
});
