# contributing guide

## baseline

- CI contract: [checks and order](./.github/workflows/CI.yml).
- Standard flow: `npm install`, `npm test`.

## architecture

- Process boot + routes + socket server: [server startup](./server/server.mjs).
- HTML templating + client config payload: [templating](./server/templating.mjs), [client config](./server/client_configuration.mjs).
- Shared toolbar catalog + versioned tool asset helpers: [tool catalog](./client-data/js/tool_catalog.js), [tool assets](./client-data/js/tool_assets.js).
- Realtime event handlers + broadcast path: [socket handlers](./server/sockets.mjs).
- Socket auth, rate-limit enforcement, payload admission: [socket policy](./server/socket_policy.mjs).
- Canonical inbound payload normalization: [message schema gate](./server/message_validation.mjs).
- In-memory board model + apply rules + disk sync: [board state engine](./server/boardData.mjs).
- Page shell that server-renders the toolbar and loads the module entrypoint for the board runtime: [board document](./client-data/board.html), [board module boot](./client-data/js/board_main.js).
- Client state machine + staged tool boot + send/receive plumbing: [board runtime](./client-data/js/board.js).
- Shared socket transport utilities: [transport helpers](./client-data/js/board_transport.js).
- Shared board-name allowlist + sanitization for landing-page inputs and server routes: [board name helpers](./client-data/js/board_name.js).
- Shared geometry/id/color/text clamps: [message primitives](./client-data/js/message_common.js).
- Tool implementations that mutate SVG/DOM: [tool modules](./client-data/tools/).
- Tool modules now default-export a tool class for dynamic `import()` boot, while legacy named `register*Tool` exports may still exist during migration.

## message lifecycle

- A tool builds payload data from pointer/input handlers and calls `Tools.drawAndSend` or `Tools.send` (tool modules + runtime).
- `Tools.drawAndSend` renders locally first with `tool.draw(data, true)`.
- The client opens Socket.IO with handshake query `board=<boardName>` and the server immediately emits `boardstate` plus the authoritative snapshot `broadcast`.
- `Tools.send` clones payload, stamps `tool`, runs hooks, and sends the plain board message over the already-bound socket.
- `Tools.sendBufferedWrite` emits immediately with `socket.emit("broadcast", message)` or appends to `Tools.bufferedWrites`; `Tools.scheduleBufferedWriteFlush` and `Tools.flushBufferedWrites` drain later.
- Server receives `socket.on("broadcast", data)` and runs board access + rate-limit checks against the board already bound to the socket.
- Server calls `normalizeBroadcastData`, which calls `normalizeIncomingMessage`; rejects include explicit reasons.
- Accepted payload is cloned for storage, then passed through `handleMessage` / `saveHistory` to `board.processMessage(...)`.
- Server relays normalized payload to peers with `socket.broadcast.to(boardName).emit("broadcast", normalizedData)`.
- Client `socket.on("broadcast", msg)` calls `handleMessage(msg)`; child batches use `BoardMessages.hasChildMessages` + `normalizeChildMessage`.
- `messageForTool` resolves `Tools.list[message.tool]` and calls `tool.draw(message, false)`; tool code mutates SVG/DOM.

## where to look by concern

- Config/env behavior: [server configuration](./server/configuration.mjs).
- Browser integration coverage: [playwright specs](./playwright/tests).
- Node behavior coverage: [rate-limit tests](./test-node/rate_limits.test.js).
- Browser runner setup: [playwright config](./playwright.config.ts).
- Server-rendered toolbar/icon/cache coverage: [server route tests](./test-node/server_routes.test.js).

## test commands

- Unified JS typecheck: `npm run typecheck` (`tsconfig.checkjs.json` covers server, scripts, Node tests, client runtime, and tool modules).
- Node suite: `node --test test-node/*.test.js`.
- Browser suite: `npx playwright test playwright/tests/<file>.spec.ts`.
- Throughput check: `npm run bench` before/after suspected performance changes.
- CPU + memory profile: `npm run profile` writes `.profiles/benchmark-server.cpuprofile` and `.profiles/benchmark-server.heapprofile`.
- Full gate: `npm test` (Node tests, Playwright, Biome `lint` with warnings treated as failures).
- Auto-format: `npm run format` (Biome `--write --unsafe`).

## notes

- `npm test` needs Chromium (`npx playwright install chromium` when missing).
- `npm test` requires local networking and browser process startup.
- In Playwright specs, assert authoritative socket/app state; avoid sleep-based timing.
- Treat HTTP and socket ingress as hostile input surfaces: malformed requests and malformed socket events must be rejected deterministically, never crash the process, and should prefer explicit 4xx-style handling over exception-driven fallthrough.
- Socket rate limits now include a text-specific per-IP fixed window via `WBO_MAX_TEXT_CREATIONS_PER_IP`; it charges every `Text/new` plus `Text/update` payloads whose `txt` contains URL-like content.

## profiling

- Run `npm run profile` to profile `scripts/benchmark-server.mjs`; `.profiles/` is gitignored and keeps local CPU and heap output together.
- CPU: open `.profiles/benchmark-server.cpuprofile` in DevTools Performance and look for hot frames with high self time or repeated stacks in `BoardData.load`, `BoardData.save`, `renderBoardToSVG`, `JSON.parse`, and `JSON.stringify`.
- Memory: open `.profiles/benchmark-server.heapprofile` in DevTools Memory and look for large sampled allocations that survive GC, especially duplicated board objects, large `_children` arrays, and serialization strings.

## formatting

- `npm run lint` runs the full Biome formatter+linter gate and fails on warnings.
- `npm run format` applies Biome safe and unsafe autofixes.
- Keep edits minimal and style-consistent unless doing full-module refactors.

## change strategy

- Message shape changes: update [server schema gate](./server/message_validation.mjs) and [shared message primitives](./client-data/js/message_common.js); rerun Node tests.
- Rate-limit changes: update [shared rate-limit helpers](./client-data/js/rate_limit_common.js), [socket policy](./server/socket_policy.mjs), and [socket handlers](./server/sockets.mjs); rerun `node --test test-node/rate_limit_common.test.js test-node/socket_policy.test.js test-node/rate_limits.test.js`.
- Persistence/replay changes: review [board state engine](./server/boardData.mjs); rerun `node --test test-node/rate_limits.test.js` and `npm test`.
- Tool UX changes: start in [tool modules](./client-data/tools/); verify with Playwright.

## design system

- Reference style: technical minimalism for a collaborative whiteboard. The app should feel precise, calm, utilitarian, and slightly futuristic, like instrument-panel chrome around an infinite canvas, not a marketing site, toy, or soft productivity app.
- Core surfaces: default to white and near-white surfaces such as `#ffffff`, `#fcfcfd`, and `#f3f4f6`. Avoid decorative gradients, tinted cards, glossy treatments, or dark-theme fragments unless the task explicitly asks for them.
- Borders and depth: define structure with thin cool-gray borders first (`#d9dde3`, stronger `#b8c0cc`), then add very light shadows only when separation is needed. Prefer crisp edges over filled, pillowy panels.
- Geometry: keep controls mostly square and compact. Use tight radii (`2px` for controls, `4px` for larger panels), avoid bubbly pills, oversized rounding, and inflated padding.
- Typography and sizing: use compact UI text (`13px` primary, `11px`-`12px` secondary) with restrained hierarchy. Controls should read as dense tools, not spacious cards.
- Accent and status colors: the default accent is a muted green in the existing family (`#abc6c6`, `#ccdfdf`). Use warning/success/destructive colors sparingly and always with text or icon support.
- Icons and affordances: prefer simple monochrome or low-color tool icons with clear silhouettes. Keep iconography functional and schematic, not playful, mascot-like, or heavily illustrated.
- Motion and behavior: transitions should be quiet and mechanical (`120ms`-`180ms`, subtle fade/slide/spinner). Avoid bounce, flourish, or constant pulsing in normal operation.
- Preserve the existing whiteboard shell. For bug fixes or small UX changes, do not restyle unrelated controls, introduce new visual systems, or rewrite shared CSS unless the task explicitly asks for a broader design pass.
- Make the smallest working change. Prefer the narrowest selector and the fewest edited rules; do not add tokens, merge components, or move layout anchors unless that is required by the bug.
- The left tool rail is the primary anchor. HUD, presence, and status UI must adapt around it; they must never cover it, intercept clicks meant for it, or force it to move.
- Persistent chrome must stay compact and utilitarian: white or near-white surfaces, thin cool-gray borders, subtle shadows, square geometry (`2px`-`4px` radii), compact type (`13px` primary, `11px`-`12px` secondary), and quiet motion.
- Idle status stays hidden. Only show persistent board-state UI when there is meaningful state to communicate.

## required upkeep

- **If behavior, paths, protocol shape, test commands, or architecture documented here changes, update this file in the same PR.**
