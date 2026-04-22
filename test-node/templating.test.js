const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { parseConfig } = require("./test_helpers.js");
const { Template } = require("../server/templating.mjs");

/**
 * @returns {Promise<Template>}
 */
async function createTemplate() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wbo-template-"));
  const templatePath = path.join(directory, "template.hbs");
  await fs.writeFile(templatePath, "{{baseUrl}}", "utf8");
  return new Template(templatePath, parseConfig());
}

test("Template.parameters uses the first forwarded host and proto values", async () => {
  const template = await createTemplate();
  const request = {
    url: "/prefix/boards/demo",
    headers: {
      "x-forwarded-proto": ["https", "http"],
      "x-forwarded-host": ["example.com", "evil.example"],
      "accept-language": "en",
    },
    socket: { encrypted: false },
  };

  const parameters = template.parameters(
    new URL("http://wbo/prefix/boards/demo"),
    /** @type {import("http").IncomingMessage} */ (
      /** @type {unknown} */ (request)
    ),
    false,
    {},
  );

  assert.equal(parameters.baseUrl, "https://example.com/prefix/");
});

test("Template.parameters prefers an exact region match over a loose base-language match", async () => {
  const template = await createTemplate();
  const request = {
    url: "/boards/demo",
    headers: {
      "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
    },
    socket: { encrypted: false },
  };

  const parameters = template.parameters(
    new URL("http://wbo/boards/demo"),
    /** @type {import("http").IncomingMessage} */ (
      /** @type {unknown} */ (request)
    ),
    false,
    {},
  );

  assert.equal(parameters.language, "zh-TW");
});

test("Template.parameters falls back loosely by base language when region is unsupported", async () => {
  const template = await createTemplate();
  const request = {
    url: "/boards/demo",
    headers: {
      "accept-language": "fr-CA,fr;q=0.9,en;q=0.8",
    },
    socket: { encrypted: false },
  };

  const parameters = template.parameters(
    new URL("http://wbo/boards/demo"),
    /** @type {import("http").IncomingMessage} */ (
      /** @type {unknown} */ (request)
    ),
    false,
    {},
  );

  assert.equal(parameters.language, "fr");
});
