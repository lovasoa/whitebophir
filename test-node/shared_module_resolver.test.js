const test = require("node:test");
const assert = require("node:assert/strict");

const SharedModuleResolver = require("../client-data/js/shared_module_resolver.js");
const MessageToolMetadata = require("../client-data/js/message_tool_metadata.js");

test("resolveSharedModule uses require in node environments", () => {
  assert.equal(
    SharedModuleResolver.resolveSharedModule(
      "./message_tool_metadata.js",
      "IgnoredGlobalName",
    ),
    MessageToolMetadata,
  );
});

test("resolveSharedModule exposes a callable resolver API", () => {
  assert.equal(typeof SharedModuleResolver.resolveSharedModule, "function");
});
