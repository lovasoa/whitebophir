const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { Template } = require("../server/templating.js");

/**
 * @returns {Promise<Template>}
 */
async function createTemplate() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wbo-template-"));
  const templatePath = path.join(directory, "template.hbs");
  await fs.writeFile(templatePath, "{{baseUrl}}", "utf8");
  return new Template(templatePath);
}

test("Template.parameters uses the first forwarded host and proto values", async function () {
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
