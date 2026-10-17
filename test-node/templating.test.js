const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createConfig } = require("./test_helpers.js");
const { Template } = require("../server/http/templating.mjs");

/**
 * @param {object} [configOverrides]
 * @returns {Promise<Template>}
 */
async function createTemplate(configOverrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wbo-template-"));
  const templatePath = path.join(directory, "template.hbs");
  await fs.writeFile(templatePath, "{{baseUrl}}", "utf8");
  return new Template(templatePath, createConfig(configOverrides));
}

test("Template.parameters uses the first forwarded host and proto values when behind a trusted proxy", async () => {
  const template = await createTemplate({
    IP_SOURCE: "X-Forwarded-For",
    TRUST_PROXY_HOPS: 1,
  });
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
  assert.equal(parameters.baseHref, "https://example.com/prefix/");
});

test("Template.parameters ignores spoofed forwarded host/proto on a direct deployment", async () => {
  const template = await createTemplate({ IP_SOURCE: "remoteAddress" });
  const request = {
    url: "/prefix/boards/demo",
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "evil.example",
      host: "real.example",
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

  assert.equal(parameters.baseUrl, "http://real.example/prefix/");
  assert.equal(parameters.baseHref, "http://real.example/prefix/");
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
