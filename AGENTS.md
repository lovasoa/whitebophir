# wbo online whiteboard

WBO is an online collaborative drawing app. This file is the working guide for
agents changing the repository.

## general instructions

- Keep changes narrow, readable, and consistent with nearby code.
- Treat HTTP and socket input as hostile. Malformed requests and socket messages must be rejected deterministically and must not crash the process.
- When behavior, paths, protocol shape, test commands, or ownership documented here changes, update this file.

## project contract

- CI is the source of truth for required checks: [.github/workflows/CI.yml](./.github/workflows/CI.yml).
- Local baseline: `npm install`, then `npm test`.
- `npm test` runs the Node suite, Playwright suite, and Biome lint. It does not run typecheck or benchmarks.
- Use `npm run typecheck` for the unified JS typecheck.
- Use `npm run bench` before and after changes, only for suspected hot-path, persistence, replay, or broadcast-throughput changes.

## source of truth

Read this section as the normal flow of a board page and a board write. Use
these files as the first place to look, and avoid duplicating owned behavior in
other modules.

### server startup and HTTP routing

Server startup begins in the [server entrypoint](./server/server.mjs), which
defines the HTTP route list and passes it with a runtime from
[create_runtime.mjs](./server/runtime/create_runtime.mjs) into
[boot.mjs](./server/runtime/boot.mjs). Boot owns the Node HTTP server,
history-directory checks, Socket.IO startup, listen, shutdown, and client-error
handling.

Startup configuration is parsed by [configuration.mjs](./server/configuration.mjs)
with shared env helpers from [helpers.mjs](./server/configuration/helpers.mjs).
Runtime logging, metrics, and tracing start from
[observability/index.mjs](./server/observability/index.mjs), with setup details
in [logging.mjs](./server/observability/logging.mjs) and metric utilities in
[metric_helpers.mjs](./server/observability/metric_helpers.mjs).
`WBO_BASE_PATH` public path handling lives with request URL parsing.

Every HTTP request passes through [dispatch.mjs](./server/http/dispatch.mjs),
where URL validation, route matching, route-level access checks, request
observation, and error responses are wired together. Supporting HTTP behavior is
kept beside it: [cache_policy.mjs](./server/http/cache_policy.mjs) chooses cache
headers, [compression.mjs](./server/http/compression.mjs) wraps compressed
responses, [templating.mjs](./server/http/templating.mjs) renders HTML shells,
and [observation.mjs](./server/http/observation.mjs) records and reports
request outcomes.

### serving a board page

Serving `/boards/{board}` is handled by
[board_page.mjs](./server/routes/board_page.mjs), with shared normalization,
ETag, cookie, and replay-baseline helpers in
[board_http_helpers.mjs](./server/routes/board_http_helpers.mjs). That route
normalizes the board name, checks board access, handles redirects and ETags,
reads the stored board document, pins the served baseline sequence for replay,
sets the user-secret cookie, and streams the board HTML shell around the SVG
baseline. Board SVG, preview, export, and download routes are in
[board_assets.mjs](./server/routes/board_assets.mjs); index redirects,
random-board redirects, and static fallbacks are in
[static.mjs](./server/routes/static.mjs).

Board access decisions belong to
[board_capabilities.mjs](./server/auth/board_capabilities.mjs). Board-scoped
JWTs use [board_jwt.mjs](./server/auth/board_jwt.mjs) and the generic helpers in
[jwt.mjs](./server/auth/jwt.mjs). `WBO_BOARD_MODERATORS` grants the existing
moderator role to board-specific user-secret cookies through
[board_moderators.mjs](./server/auth/board_moderators.mjs). The user-secret cookie is handled by
[user_secret_cookie.mjs](./server/auth/user_secret_cookie.mjs), and board-name
normalization shared with the browser is in
[board_name.js](./client-data/js/board_name.js).

The board HTML shell in [board.html](./client-data/board.html) carries the
chrome, embedded configuration/translations/board state, and inline
authoritative `<svg id="canvas">` baseline with `<g id="drawingArea">`.

### browser boot and runtime

The browser starts in [board_main.js](./client-data/js/board_main.js). It uses
[board_bootstrap.js](./client-data/js/board_bootstrap.js) and
[app_tools_core.js](./client-data/js/app_tools_core.js) to create a minimal
runtime shell, then [board_dom_bootstrap.js](./client-data/js/board_dom_bootstrap.js)
attaches the server-rendered board DOM and reads the inline baseline sequence.
After the viewport is restored, [board.js](./client-data/js/board.js) hydrates
the full runtime.
The board boot process is carefully crafted to prioritize which assets are loaded first in order to arrive at an interactive zoom+pan board ASAP. Be careful never to add unnecessary cruft on the critical path. Adding a new frontend file that has to be carefully considered for boot time impact.

[app_tools.js](./client-data/js/app_tools.js) assembles that full runtime from
modules in [board_full_runtime_modules.js](./client-data/js/board_full_runtime_modules.js)
and shared classes in [board_runtime_core.js](./client-data/js/board_runtime_core.js).
Once hydrated, viewport, zoom, pan, and canvas growth are handled by
[board_viewport.js](./client-data/js/board_viewport.js) and
[board_extent.js](./client-data/js/board_extent.js). Page chrome, status, board
access, and presence are handled by
[board_shell_module.js](./client-data/js/board_shell_module.js),
[board_status_module.js](./client-data/js/board_status_module.js),
[board_access_module.js](./client-data/js/board_access_module.js), and
[board_presence_module.js](./client-data/js/board_presence_module.js). Socket
connection, replay, received-message dispatch, optimistic state, and outgoing
writes are handled by
[board_connection_module.js](./client-data/js/board_connection_module.js),
[board_replay_module.js](./client-data/js/board_replay_module.js),
[board_message_module.js](./client-data/js/board_message_module.js),
[board_optimistic_module.js](./client-data/js/board_optimistic_module.js), and
[board_write_module.js](./client-data/js/board_write_module.js).

### tools and client messages

[manifest.js](./client-data/tools/manifest.js) defines tool identity, stable
numeric tool codes, capability requirements, live-message fields, and stored SVG
contracts. Tool order and defaults are split into
[tool-order.js](./client-data/tools/tool-order.js) and
[tool-defaults.js](./client-data/tools/tool-defaults.js). The runtime loads and
mounts tools through
[board_tool_registry_module.js](./client-data/js/board_tool_registry_module.js),
which also drains pending messages for lazy-loaded tools and owns active-tool
pointer dispatch. Shared tool exports live in
[index.js](./client-data/tools/index.js), shape behavior is shared through
[shape_contract.js](./client-data/tools/shape_contract.js) and
[shape_tool.js](./client-data/tools/shape_tool.js), and each concrete tool keeps
its interaction, DOM, rendering, cleanup, and stored-item behavior in
`client-data/tools/<tool-id>/index.js`.

When a user interaction modifies the board, the active tool creates a live board
message with primitives from [message_common.js](./client-data/js/message_common.js),
limits from [message_limits.js](./client-data/js/message_limits.js), tool and
mutation metadata from
[message_tool_metadata.js](./client-data/js/message_tool_metadata.js), and
mutation codes from [mutation_type.js](./client-data/js/mutation_type.js). The
write module assigns a `clientMutationId` for persistent writes, captures
optimistic rollback, draws locally, applies message hooks such as extent growth,
and sends the message through
[board_transport.js](./client-data/js/board_transport.js) as a Socket.IO
`broadcast` event on the active socket.

### socket connection, replay, and writes

The Socket.IO server is started and wired in
[socket/index.mjs](./server/socket/index.mjs). On connect,
[replay.mjs](./server/socket/replay.mjs) binds and normalizes the board name,
checks board access, loads or reuses the board, compares the client's
`baselineSeq` with the board mutation log, and prepares a replay batch. The
connection then emits `boardstate` followed by a `broadcast` replay batch before
marking the socket as synced for persistent live broadcasts.

Client `broadcast` messages enter
[broadcasts.mjs](./server/socket/broadcasts.mjs) and are handled in this order:

1. Resolve the client IP and board user, then enforce Turnstile when required.
2. Apply pre-normalization rate limits with
   [rate_limits.mjs](./server/socket/rate_limits.mjs).
3. Use [policy.mjs](./server/socket/policy.mjs) and
   [message_validation.mjs](./server/socket/message_validation.mjs) to normalize
   and validate the message shape, including blocked-tool checks.
4. Apply post-normalization rate limits with the same rate-limit module.
5. Check board permissions for the normalized mutation.
6. For cursor messages, update presence and rebroadcast the ephemeral message
   without persistence.
7. For persistent mutations, serialize acceptance through the per-board
   queue in [session.mjs](./server/board/session.mjs), apply the mutation to
   [data.mjs](./server/board/data.mjs) through
   [message_processing.mjs](./server/board/message_processing.mjs), record it in
   [mutation_log.mjs](./server/board/mutation_log.mjs), and emit sequenced
   `broadcast` frames to synced clients and the sender.

[presence.mjs](./server/socket/presence.mjs) tracks connected board users,
[reports.mjs](./server/socket/reports.mjs) handles user reports,
[ban store](./server/socket/bans.mjs) tracks moderator report-to-ban state, and
[turnstile.mjs](./server/socket/turnstile.mjs) validates Turnstile tokens.
Client and server share rate-limit math through
[rate_limit_common.js](./client-data/js/rate_limit_common.js).

On the browser side, socket `broadcast` frames are queued by the connection
module and consumed by the replay module. Replay enforces sequence order,
applies replay batches, refreshes the authoritative SVG baseline when replay is
not possible, and then passes messages to the message module. The message module
updates hooks and calls the owning tool's `draw` method; unknown tool messages
are held until that tool is booted.

### board state and persistence

In memory, [data.mjs](./server/board/data.mjs) represents a board as a
canonical item index. [canonical_items.mjs](./server/board/canonical_items.mjs)
defines item shape, [canonical_index.mjs](./server/board/canonical_index.mjs)
owns lookup and paint order, and [svg_extent.mjs](./server/board/svg_extent.mjs)
tracks the SVG extent. Mutation application stays in
[message_processing.mjs](./server/board/message_processing.mjs), while
[data_persistence.mjs](./server/board/data_persistence.mjs) owns autosave
scheduling, load, save, unload, and stale-save handling.

On disk, stored SVG is authoritative. [svg_board_store.mjs](./server/persistence/svg_board_store.mjs)
reads served baselines, loads canonical board state, writes fresh SVGs, and
rewrites existing SVGs. It relies on
[streaming_stored_svg_scan.mjs](./server/persistence/streaming_stored_svg_scan.mjs)
for structural scans,
[stored_svg_item_codec.mjs](./server/persistence/stored_svg_item_codec.mjs) for
item decode/encode, [svg_envelope.mjs](./server/persistence/svg_envelope.mjs)
for root metadata and drawing-area boundaries, and
[legacy_json_svg_migration.mjs](./server/persistence/legacy_json_svg_migration.mjs)
for legacy JSON conversion. Persistence paths and timing are configured through
`WBO_HISTORY_DIR`, `WBO_SAVE_INTERVAL`, `WBO_MAX_SAVE_DELAY`, and
`WBO_SEQ_REPLAY_RETENTION_MS`. Board moderators are configured with
`WBO_BOARD_MODERATORS` as space-separated `board:secret[,secret]` groups.

### tests, benchmarks, and profiling

Use [test-node](./test-node) for Node tests and
[playwright/tests](./playwright/tests) with
[playwright.config.ts](./playwright.config.ts) for browser integration tests.
Server benchmarks are in [benchmark-server.mjs](./scripts/benchmark-server.mjs),
profiling starts from
[profile-benchmark-server.mjs](./scripts/profile-benchmark-server.mjs), and the
peer-visible erase benchmark is
[benchmark-peer-visible-erase.mjs](./scripts/benchmark-peer-visible-erase.mjs).

## wire socket protocol

WBO uses Socket.IO. Clients connect with query fields such as `board`,
`baselineSeq`, `token`, `tool`, `color`, and `size`. The server immediately emits
`boardstate`, then emits a `broadcast` replay batch from the requested
`baselineSeq`.

Live board writes are JSON messages sent on the `broadcast` event. They use
numeric `tool` codes from [client-data/tools/manifest.js](./client-data/tools/manifest.js)
and numeric mutation `type` codes from [client-data/js/mutation_type.js](./client-data/js/mutation_type.js):
`1` create, `2` update, `3` delete, `4` append, `5` batch, `6` clear, `7` copy.
The server validates client messages, rejects malformed writes with
`mutation_rejected`, and rebroadcasts accepted persistent writes as sequenced
`broadcast` frames.

User reports are sent by clients on the `report_user` event with a payload of
`{ "socketId": "<reported socket id>" }`. Moderator warning/ban payloads use
`banDurationMs`: `0` warns without banning, a positive number bans for that
duration, and an omitted or invalid value preserves the legacy default
15-minute ban. Ban durations are clamped to at most one week. Before the
reported socket is closed, the server emits
`moderation_disconnect { "banDurationMs": <duration> }`; `0` means warning and a
positive value means ban. Non-moderator reports disconnect the reporter and
reported user after logging the report, emit
`moderation_disconnect { "banDurationMs": 0 }` only to the reported target, and
do not ban. For accepted non-moderator reports, the server emits
`user_reported` only to connected moderators on that board. The `user_reported`
payload is `{ "reporterName": "<display name>", "reportedName": "<display name>" }`.
Moderator warning/ban actions do not emit `user_reported`; warning actions only
disconnect the reported user, while ban actions also ban the reported secret and
IP.

Client write messages normally have top-level `tool` and `type` fields.
Tool-owned batches have top-level `tool` plus `_children`; each child carries its
own mutation `type`. Normal socket batches are capped by `WBO_MAX_CHILDREN`, but
users with the existing `canClear` capability bypass that batch-size cap.
Server `broadcast` payloads are either bare ephemeral messages, sequenced
persistent mutations, or replay batches with `type: 5`, `fromSeq`, `seq`, and
`_children`.

Client `broadcast` payload examples. Comments are explanatory; they are not sent
on the wire.

```jsonc
{
  // Rectangle tool.
  "tool": 3,
  // MutationType.CREATE.
  "type": 1,
  "id": "rmou34r3xa", // Rectangle IDs are generated as "r" + base36 timestamp + base36 suffix.
  "color": "#1f2937",
  "size": 10,
  "opacity": 0.85,
  "x": 120,
  "y": 80,
  "x2": 240,
  "y2": 160,
  // Generated by the write module as "cm-" + base36 timestamp + base36 suffix.
  "clientMutationId": "cm-mou34r3xc"
}
```

```jsonc
{
  // Hand tool batch. The parent carries the tool; children carry mutation types.
  "tool": 7,
  "clientMutationId": "cm-mou34r3xd",
  "_children": [
    {
      // MutationType.UPDATE with an affine SVG transform.
      "type": 2,
      "id": "rmou34r3xa",
      "transform": { "a": 1, "b": 0, "c": 0, "d": 1, "e": 10, "f": 20 }
    },
    {
      // MutationType.COPY. Hand copies keep the source ID's first-character prefix.
      "type": 7,
      "id": "rmou34r3xa",
      "newid": "rmou34r3xb"
    }
  ]
}
```

Server `broadcast` payload examples:

```jsonc
{
  // Server-assigned persistent sequence.
  "seq": 42,
  "acceptedAtMs": 1710000000000,
  "mutation": {
    "tool": 3,
    "type": 1,
    "id": "rmou34r3xa",
    "color": "#1f2937",
    "size": 10,
    "opacity": 0.85,
    "x": 120,
    "y": 80,
    "x2": 240,
    "y2": 160,
    "clientMutationId": "cm-mou34r3xc",
    // The sender socket id is echoed only on the primary live broadcast.
    "socket": "server-socket-id"
  }
}
```

```jsonc
{
  // Authoritative replay batch sent after connect.
  "type": 5,
  "fromSeq": 40,
  "seq": 42,
  "_children": [
    {
      "tool": 3,
      "type": 1,
      "id": "rmou34r3xa",
      "color": "#1f2937",
      "size": 10,
      "opacity": 0.85,
      "x": 120,
      "y": 80,
      "x2": 240,
      "y2": 160,
      "clientMutationId": "cm-mou34r3xc"
    }
  ]
}
```

Important files:

- Events and message codes: [client-data/js/socket_events.js](./client-data/js/socket_events.js),
  [client-data/tools/manifest.js](./client-data/tools/manifest.js),
  [client-data/js/mutation_type.js](./client-data/js/mutation_type.js), and
  [client-data/js/message_tool_metadata.js](./client-data/js/message_tool_metadata.js).
- Client connection/send/receive: [client-data/js/board_transport.js](./client-data/js/board_transport.js),
  [client-data/js/board_write_module.js](./client-data/js/board_write_module.js), and
  [client-data/js/board_connection_module.js](./client-data/js/board_connection_module.js).
- Server admission and fan-out: [server/socket/message_validation.mjs](./server/socket/message_validation.mjs),
  [server/socket/policy.mjs](./server/socket/policy.mjs),
  [server/socket/replay.mjs](./server/socket/replay.mjs), and
  [server/socket/broadcasts.mjs](./server/socket/broadcasts.mjs).

## persisted board file format

Persisted boards are SVG documents. The root SVG carries `data-wbo-format`,
`data-wbo-seq`, `data-wbo-readonly`, `width`, and `height`; drawable items live
under `<g id="drawingArea">`. Stored items use SVG tag names; those tag names map
back to string tool ids when the server decodes the file.

Minimal stored SVG example:

```svg
<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" width="1000" height="800" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="42" data-wbo-readonly="false">
<defs id="defs"></defs>
<g id="drawingArea">
<!-- Rectangle item. The stored tag maps back to the "rectangle" tool. -->
<rect id="rmou34r3xa" x="120" y="80" width="120" height="80" stroke="#1f2937" stroke-width="10" fill="none" opacity="0.85"></rect>
<!-- Pencil item. Pencil IDs are generated with the "l" prefix in live tool code. -->
<path id="lmou34r3xe" d="M 120 80 l 20 10" stroke="#1f2937" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>
<!-- Text item. Text IDs are generated with the "t" prefix. -->
<text id="tmou34r3xf" x="120" y="220" font-size="24" fill="#1f2937">Hello WBO</text>
</g>
<g id="cursors"></g>
</svg>
```

Important files:

- Envelope and root metadata: [server/persistence/svg_envelope.mjs](./server/persistence/svg_envelope.mjs)
  and [server/persistence/svg_board_store.mjs](./server/persistence/svg_board_store.mjs).
- Scan, load, and rewrite: [server/persistence/streaming_stored_svg_scan.mjs](./server/persistence/streaming_stored_svg_scan.mjs)
  and [server/persistence/stored_svg_item_codec.mjs](./server/persistence/stored_svg_item_codec.mjs).
- Tool stored-item contracts: [client-data/tools/index.js](./client-data/tools/index.js),
  [client-data/tools/shape_contract.js](./client-data/tools/shape_contract.js), and
  `client-data/tools/<tool-id>/index.js`.

## core invariants

- Server live-message admission validates and rejects. Client tools own
  UX-side clamping and normalization before optimistic draw/send.
- After a tool calls `Tools.drawAndSend`, `Tools.send`, or write-buffer APIs, the
  runtime owns that message object. Callers must not mutate it.
- Persistent socket writes flow through policy, rate limits, the per-board
  session, board mutation application, mutation-log recording, and sequenced
  broadcasts. Cursor messages are ephemeral and are not persisted or replayed.
- Connection replay starts from the SVG baseline sequence attached to the page.
  Reconnects refresh the authoritative SVG baseline before opening a new socket
  when replay is not possible.
- Canonical board items store scalar fields in `attrs`, `transform` once at the
  item top level, and payload-specific state under `payload`.
- Stored SVG is authoritative. `.svg.bak` is a transient save staging file, and
  unreadable primary SVGs are quarantined before fallback. Legacy `.json`
  boards are migration inputs, not the steady-state format.
- Stored SVG structural scan, summary decode, and full materialization are
  separate. Bad recognized items may be skipped; broken SVG structure is an
  error. Do not turn structural failures into silent repairs.
- Board pages stream stored SVG baselines through the HTML shell. The board chrome
  and boot payloads must remain before the streamed board markup.
- All user-visible strings MUST be localized via `Tools.i18n`. All [translation keys](server/http/translations.json) MUST have a carefully designed, natural sounding, context-aware version in ALL supported languages.

## hot paths

Hot paths include live socket message validation, per-coordinate message
helpers, board load, canonical item materialization, mutation application,
stored-SVG summary scan, save/rewrite, and broadcast fan-out.

When touching hot paths:

- Do not read env or rebuild config inside per-item, per-child, or
  per-coordinate work. Capture or pass values once at the boundary.
- Avoid avoidable allocations, cloning, regex creation, and spans inside
  per-coordinate loops.
- Use summary decode for board load and canonical indexing. Do not hydrate Pencil
  point arrays on board open, save, rewrite, or copy unless the active tool
  interaction truly needs them.
- Do not read source SVG from live socket-message paths. SVG source reads belong
  to board load, served baseline reads, and persistence rewrite.
- Use `withExpensiveActiveSpan` or a span around a batch for high-volume work.
  Do not start `withActiveSpan` per item.
- Run `npm run bench` before and after suspected hot-path changes. Use
  `npm run bench -- <e2e|load|persist|broadcast>` or the matching shortcut when
  one scenario is enough.

## frontend rules

- Preserve the existing whiteboard shell. Small UX fixes should not restyle
  unrelated controls or introduce a new visual system.
- The left tool rail is the primary anchor. HUD, presence, status, and popovers
  must not cover it, intercept clicks meant for it, or force it to move.
- Viewport, zoom, pan, URL hash, scroll bounds, and board extent logic belong in
  [client-data/js/board_viewport.js](./client-data/js/board_viewport.js) and
  [client-data/js/board_extent.js](./client-data/js/board_extent.js).
- Generic message hooks must derive extent from persistent/content payloads only.
  Ephemeral messages such as cursor updates must not grow the board extent.
- SVG layout measurement such as `getBBox()` is allowed only in narrow tool
  interaction paths over a small selected/updated element set. Do not traverse or
  measure the whole board SVG from generic gesture or message handling.
- Treat SVG-affecting CSS as board-load sensitive; style recalculation can make
  existing boot-time SVG reads such as `getPathData()` very expensive.
- Scale-disabled draw tools remain selectable; interaction is blocked, the board
  cursor is `not-allowed`, and status explains that the user must zoom in.
- Tool modules own tool-specific DOM behavior, stored-item summary/serialization,
  rendering, boot hooks, cleanup hooks, and rejection/disconnect handling.

## design system

- Style target: precise, calm, utilitarian whiteboard chrome around an infinite
  canvas.
- Default surfaces are white or near-white (`#ffffff`, `#fcfcfd`, `#f3f4f6`).
  Avoid decorative gradients, tinted cards, glossy treatments, and dark-theme
  fragments unless explicitly requested.
- Use thin cool-gray borders first (`#d9dde3`, stronger `#b8c0cc`) and very
  light shadows only when separation is needed.
- Keep controls compact and mostly square. Use tight radii: `2px` for controls,
  `4px` for larger panels.
- Use compact UI type: `13px` primary, `11px` to `12px` secondary.
- Default accent colors are the muted green family (`#abc6c6`, `#ccdfdf`).
- Idle status stays hidden. Only show persistent board-state UI when there is
  meaningful state to communicate.

## test commands

- Typecheck: `npm run typecheck`.
- Node suite: `npm run test-node` or targeted `node --test test-node/<file>.test.js`.
- Browser suite: `npm run test:pw` or targeted
  `npx playwright test playwright/tests/<file>.spec.ts`.
- Lint: `npm run lint`.
- Format: `npm run format`.
- Full local gate: `npm test`.
- Benchmarks: `npm run bench`, `npm run bench:load`, `npm run bench:persist`,
  `npm run bench:broadcast`, `npm run bench:e2e`.
- Profiling: `npm run profile -- <e2e|load|persist|broadcast>`.

`npm test` needs Chromium and local browser/network capability. If Chromium is
missing, run `npx playwright install chromium`.

In Playwright specs, assert authoritative app or socket state. Avoid sleeps. When
browser tests fail or flake, prefer fixing the application behavior over adding
test workarounds.

## change checklist

- Message shape or protocol: update the schema/metadata sources, shared message
  helpers, client send/draw paths if needed, focused Node tests, and benchmarks
  if a hot normalizer changed.
- Config/env: update [server/configuration.mjs](./server/configuration.mjs) and
  focused tests. Do not add memoization layers or reset hooks inside
  configuration.
- Rate limits: update shared rate-limit logic first, then server enforcement and
  policy. Run `node --test test-node/rate_limit_common.test.js test-node/socket_policy.test.js test-node/rate_limits.test.js`.
- Persistence, replay, or board state: review board data/session/persistence and
  SVG store together. Run focused Node tests and benchmarks for affected load,
  persist, or broadcast paths.
- Auth or permissions: start in `server/auth`, then verify HTTP routes and socket
  policy. Run relevant auth, route, and socket tests.
- Tool UX: start in `client-data/tools/<tool-id>`, shared tool helpers only when
  duplication is real, and verify with targeted Playwright or client-tool tests.
- HTTP template, cache, compression, or routing: update the route/helper source
  and server-route tests.

## profiling notes

- `npm run profile -- <scenario>` writes CPU and heap profiles under
  `.profiles/`.
- Use profiling after a benchmark regression, not as a routine check.
