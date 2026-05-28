const assert = require("node:assert/strict");
const test = require("node:test");

const CONTRACTS_PATH = "../client-data/tools/contracts.js";
const MANIFEST_PATH = "../client-data/tools/manifest.js";
const INDEX_PATH = "../client-data/tools/index.js";

/**
 * @template T
 * @param {Promise<T>} value
 * @returns {Promise<T>}
 */
function load(value) {
  return value;
}

test("wire tool codes match the documented protocol", async () => {
  const { TOOL_CODE_BY_ID } = await load(import(MANIFEST_PATH));
  assert.deepEqual(TOOL_CODE_BY_ID, {
    pencil: 1,
    "straight-line": 2,
    rectangle: 3,
    ellipse: 4,
    text: 5,
    eraser: 6,
    hand: 7,
    grid: 8,
    download: 9,
    zoom: 10,
    clear: 11,
    cursor: 12,
  });
});

test("mutation type codes match the documented protocol", async () => {
  const { MutationType } = await load(
    import("../client-data/js/mutation_type.js"),
  );
  assert.deepEqual(
    {
      CREATE: MutationType.CREATE,
      UPDATE: MutationType.UPDATE,
      DELETE: MutationType.DELETE,
      APPEND: MutationType.APPEND,
      BATCH: MutationType.BATCH,
      CLEAR: MutationType.CLEAR,
      COPY: MutationType.COPY,
    },
    {
      CREATE: 1,
      UPDATE: 2,
      DELETE: 3,
      APPEND: 4,
      BATCH: 5,
      CLEAR: 6,
      COPY: 7,
    },
  );
});

test("code-to-tool maps round trip through the explicit maps", async () => {
  const { TOOL_CODE_BY_ID, TOOL_ID_BY_CODE } = await load(
    import(MANIFEST_PATH),
  );
  for (const [toolId, code] of Object.entries(TOOL_CODE_BY_ID)) {
    assert.equal(TOOL_ID_BY_CODE[code], toolId, `code ${code} -> ${toolId}`);
  }
  for (const [code, toolId] of Object.entries(TOOL_ID_BY_CODE)) {
    assert.equal(
      TOOL_CODE_BY_ID[toolId],
      Number(code),
      `${toolId} -> code ${code}`,
    );
  }
});

test("server-safe contracts agree with the manifest for every tool", async () => {
  const { TOOL_CONTRACT_BY_ID } = await load(import(CONTRACTS_PATH));
  const { TOOL_BY_ID } = await load(import(MANIFEST_PATH));
  for (const [toolId, manifestEntry] of Object.entries(TOOL_BY_ID)) {
    const contract = TOOL_CONTRACT_BY_ID[toolId];
    assert.ok(contract, `missing contract for ${toolId}`);
    assert.equal(contract.id, manifestEntry.id, `${toolId} id`);
    assert.equal(contract.toolId, manifestEntry.toolId, `${toolId} toolId`);
    assert.equal(
      contract.storedTagName,
      manifestEntry.storedTagName,
      `${toolId} storedTagName`,
    );
    assert.equal(
      contract.payloadKind,
      manifestEntry.payloadKind,
      `${toolId} payloadKind`,
    );
    assert.deepEqual(
      contract.updatableFields,
      manifestEntry.updatableFields,
      `${toolId} updatableFields`,
    );
    assert.equal(
      contract.requiredCapability,
      manifestEntry.requiredCapability,
      `${toolId} requiredCapability`,
    );
  }
});

test("storage contracts expose serialize/summarize for every stored tool", async () => {
  const { STORAGE_CONTRACT_BY_ID, TOOL_CONTRACT_BY_STORED_TAG_NAME } =
    await load(import(CONTRACTS_PATH));
  for (const [toolId, contract] of Object.entries(STORAGE_CONTRACT_BY_ID)) {
    assert.equal(typeof contract.summarizeStoredSvgItem, "function", toolId);
    assert.equal(typeof contract.serializeStoredSvgItem, "function", toolId);
    assert.ok(
      typeof contract.storedTagName === "string",
      `${toolId} storedTagName`,
    );
    assert.equal(
      TOOL_CONTRACT_BY_STORED_TAG_NAME[contract.storedTagName].toolId,
      toolId,
      `${toolId} tag round trip`,
    );
  }
});

test("the runtime browser registry and the server contracts share metadata", async () => {
  const { TOOL_BY_ID: RUNTIME_BY_ID } = await load(import(INDEX_PATH));
  const { TOOL_CONTRACT_BY_ID } = await load(import(CONTRACTS_PATH));
  for (const [toolId, contract] of Object.entries(TOOL_CONTRACT_BY_ID)) {
    const runtime = RUNTIME_BY_ID[toolId];
    assert.ok(runtime, `runtime missing ${toolId}`);
    assert.equal(runtime.id, contract.id, `${toolId} id`);
    assert.equal(
      runtime.storedTagName,
      contract.storedTagName,
      `${toolId} storedTagName`,
    );
    assert.equal(
      runtime.payloadKind,
      contract.payloadKind,
      `${toolId} payloadKind`,
    );
    assert.equal(
      runtime.requiredCapability,
      contract.requiredCapability,
      `${toolId} requiredCapability`,
    );
  }
});
