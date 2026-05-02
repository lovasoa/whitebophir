# Pencil responsiveness performance plan

## Problem statement

The current pencil path mutates the main board SVG on every accepted point.
On dense boards this pushes Chrome through SVG invalidation, paint, layerization,
commit, and hit-test work for a document with tens of thousands of elements.
The [huge trace](/tmp/chrometrace.json) that motivated this plan showed JavaScript pointer handlers as small
relative to browser rendering work: the expensive time was in `Paint`,
`Layerize`, `Commit`, `UpdateLayer`, and `HitTest`.

The goal is to make active pencil drawing responsive on dense boards without
turning the client into a large rendering subsystem. Optimizations should be
small, local where possible, and enforceable by tests that do not depend on
strict wall-clock timing.

## Constraints

- Keep the board architecture SVG-backed. Do not start a large rewrite.
- Keep pencil-specific logic in `client-data/tools/pencil/`.
- Centralize cross-tool interaction side effects so tools cannot leak global
  state after cancellation, rejection, socket disconnect, or tool switches.
- Avoid adding a large general-purpose scheduler. Prefer narrow leases, RAF batching, and small helpers.
- Preserve optimistic write semantics and existing socket protocol
- Preserve eraser and hand hit-testing behavior outside active pencil strokes.

## Browser model summary

Chrome RenderingNG is organized around a document lifecycle: style, layout, pre-paint, paint, compositing/layerization, commit, and raster/composite.
Updates that are only compositor transforms can skip much of that work, but SVG geometry mutations cannot. They invalidate paint and geometry data.

The local Chromium geometry notes describe property trees for transforms, effects, clips, and scrolls, and emphasize caching geometry mapping and hit-test data when state does not change. The pencil path is currently the opposite case: every point changes SVG path geometry in the large board tree.

SVG 2 defines `pointer-events: bounding-box` for container elements and graphics
elements. That means the Pencil overlay `<svg>` itself can be the hit-test
surface while the tool is selected; no separate rect and no `#drawingArea`
pointer-events mutation are needed.

## Implementation phases

### Phase 0: Reproducible baseline (done)

Before changes, keep one reproducible browser scenario:

- Load a dense SVG board with thousands of persisted items.
- Select pencil.
- Draw one 80-120 point stroke through the normal tool path.
- Collect DevTools trace manually for diagnosis when needed.

Do not put hard duration budgets into CI. Use the trace for local diagnosis and use Playwright for structural invariants.

The baseline is in /tmp/chrometrace.json

### Phase 1: Centralized interaction leases

Add lease-based interaction state to the runtime before adding more tool-side optimizations.

Recommended owner:

- Put the lease manager in `InteractionModule` in
  `client-data/js/board_full_runtime_modules.js`.
- Keep raw DOM toggles in `BoardDomRuntimeActions` in
  `client-data/js/board_runtime_core.js` if the toggle is board-DOM-specific.
- Expose owner-scoped methods through `createToolRuntimeModules()` in
  `client-data/js/board_tool_registry_module.js`, closing over the tool name
  from `createToolBootContext(toolName)`.

The lease API should be small:

```js
const lease = runtime.interaction.acquire({
  suppressOwnCursor: true,
});
lease.release();
```

Properties:

- `release()` is idempotent.
- The interaction module stores leases by generated token and owner tool name.
- The tool runtime facade does not let a tool claim another owner's lease.
- `ToolRegistryModule.replaceCurrentTool()` calls
  `Tools.interaction.releaseOwner(oldTool.name)` after `oldTool.onquit(...)`.
- `ReplayModule.beginAuthoritativeResync()` and socket-disconnect cleanup also
  release active leases, either through mounted tool hooks or an explicit
  runtime cleanup.

Why this module:

- `InteractionModule` already owns pointer/cursor visibility flags.
- Tool registry owns tool lifecycle, so it can guarantee cleanup on tool
  switches.
- Keeping drawing-area hit testing out of this lease avoids a dense-subtree
  style invalidation at the start of a Pencil stroke.

Acceptance criteria:

- Pencil can acquire cursor suppression on press and release it on normal
  release.
- Switching from pencil to any other tool clears the cursor suppression.
- Socket disconnect, mutation rejection, clear/delete of the active line, and
  touch cancellation clear suppression.
- Eraser and hand still see normal hit targets when they are active.

### Phase 2: Pencil overlay as the hit-test surface

Use Pencil's existing live overlay for tool-lifetime hit testing:

- Create the overlay SVG in `client-data/tools/pencil/index.js`.
- Add an active class while Pencil is the selected tool, not only while a stroke
  is in progress.
- In `client-data/tools/pencil/pencil.css`, set the active overlay to
  `pointer-events: bounding-box`.
- Keep the overlay path itself at `pointer-events: none` so the overlay SVG is
  the stable event target.
- Remove the old `#drawingArea` pointer-events suppression path.

Expected impact:

- Empty board space targets the small overlay SVG instead of asking the browser
  to hit-test the dense persisted drawing tree.
- The pointer-down path no longer toggles a class on `#drawingArea`, which was
  the trace-visible source of the giant start-of-stroke style recalculation.
- No extra shield rect is needed.

Risk:

- Low in Chromium and spec-backed for SVG 2. Browser behavior remains
  user-visible pencil drawing; tests should not need to name the overlay.

### Phase 3: Cursor and presence rendering policy

#### Cursor policy

Do not render the local cursor marker while a pencil stroke is in progress.

Implementation:

- The pencil lease also requests `suppressOwnCursor`.
- The cursor tool checks `runtime.interaction.isOwnCursorSuppressed()` before
  mutating `#cursor-me`.
- If needed later, add `suppressRemoteCursors`, but start with own cursor only.

Reason:

- The trace showed repeated `circle#cursor-me` layout invalidations during the
  drawing sequence.
- The visible pencil stroke itself is the pointer feedback during drawing.

Acceptance criteria:

- During active pencil stroke, local cursor DOM does not update.
- After release/cancel, cursor rendering resumes automatically.
- No direct `showMyCursor = false` mutations from the pencil tool; suppression
  must be lease-scoped.

#### Presence policy

Separate presence data updates from DOM rendering.

Current problem:

- `updateConnectedUsersFromActivity()` can call `renderConnectedUsers()` for
  each activity update.
- The activity pulse is already CSS animation, but JS restarts and ends it by
  mutating rows and timeout state on activity.

Recommended architecture:

- Keep user activity data in `PresenceModule`.
- Add `schedulePresenceRender(reason)` that coalesces DOM rendering with
  `requestAnimationFrame`.
- If the connected-users panel is closed, do not render row activity changes.
  Only update data and the toggle badge when the user count changes.
- If the panel is open, patch only rows whose display state changed when
  possible. Avoid sorting/rebuilding the whole list for activity-only updates.

Activity animation:

- Treat activity as a state window, not one DOM restart per message.
- On first activity after idle, set `user.activeUntil = now + ttl` and mark the
  row active.
- On further activity while active, extend `activeUntil` but do not rerender or
  restart the animation.
- CSS can run a quiet infinite pulse while the row is active:

```css
.connected-user-color.active {
  animation: connected-user-pulse 700ms ease-out infinite;
}
```

- JS owns the guarantee that activity ends: one timeout per active user checks
  `activeUntil` and removes the active class after the quiet period.
- `clearConnectedUsers()` and row removal must clear timeout ids.

Acceptance criteria:

- Continuous activity can keep the pulse active, but when activity stops the
  pulse must end without requiring another render event.
- Hidden panels do not do per-message row DOM work.
- Toggle label/badge remains correct.

Risk:

- Low to medium. Presence is user-visible but not protocol-critical.
- Keep this change separate from pencil rendering so regressions are easy to
  isolate.

### Phase 4: Main local rendering fix

Render the active local stroke outside the main board SVG, and do not mutate
`#drawingArea` for local pencil points until the stroke ends.

This is the lowest-risk main fix because it preserves the existing message
shape, live send behavior, and persistence model while removing the trace-visible
large-SVG paint/commit work from the local input path.

#### Key idea

During an active local pencil stroke:

- `drawAndSend()` still sends the live create and append messages immediately.
- The local create stores only stroke metadata and starts a pencil-owned
  overlay.
- Local appends update JS path data plus the overlay; they do not create a
  `#drawingArea` path and do not set `d` on a board path.
- On release or child-limit rollover, Pencil creates the real board path once
  and writes the final `d`.
- Remote and replay pencil messages still mutate `#drawingArea` immediately.

The optimistic policy is intentionally simple:

- While the stroke is active, generic rollback snapshots "no board item" for the
  local create. A rejection discards the overlay and path cache.
- A rejected append sends one cleanup delete for the stroke id, because the
  server may have accepted an earlier prefix.
- After release, a rejected append removes the materialized local path and uses
  the same deduplicated cleanup delete.
- Clear, delete, cancel, disconnect, and tool switch all clear overlay state and
  local path cache.

#### DOM structure

Create a pencil-owned overlay lazily:

```html
<svg class="wbo-pencil-live-overlay" aria-hidden="true">
  <path class="wbo-pencil-live-path"></path>
</svg>
```

CSS:

```css
.wbo-pencil-live-overlay {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 20; /* above the board, below the menu and HUD*/
  overflow: visible;
  transform-origin: 0 0;
}
```

The menu is `z-index: 60` and the HUD is `z-index: 35`, so `z-index: 20` keeps
the stroke above the board but below chrome.

#### Coordinate model

Keep the overlay in board coordinates under the board container. Normal document
scrolling moves it with the board, so the overlay must not read
`scrollLeft`/`scrollTop` during active drawing.

Use one CSS transform on the overlay SVG:

```text
scale(currentScale)
```

This preserves the current board zoom behavior, including scaled stroke width,
without converting every point to screen coordinates and without the forced
layout trigger from reading document scroll state.

During an active stroke, the overlay renderer should refresh the transform on:

- point append RAF flush,
- `resize`,
- scale changes if an API hook exists or if the transform is recomputed on each
  RAF while active.

Pencil drawing owns app gestures, so scroll/scale changes during a stroke are
rare; the refresh path is mostly defensive.

#### Module split

Keep pencil-specific rendering and optimistic policy in
`client-data/tools/pencil/index.js`. The stylesheet remains in
`client-data/tools/pencil/pencil.css`.

Responsibilities:

- Create/remove/reuse the overlay SVG and path.
- Copy stroke style from pencil message metadata.
- Accept latest `pathData`.
- Schedule one RAF flush.
- On flush, set overlay path `d`, stroke attrs, opacity, size, and transform.
- Clear overlay on release/cancel/rejection/disconnect.

Keep smoothing and active path data in existing pencil code:

- `wboPencilPoint()` remains the single smoothing function.
- `state.pathDataCache[lineId]` is the active local path-data array.
- The overlay and the one final committed board path both render from that same
  data.

#### Board path behavior

Active local drawing should not add a pencil path to `#drawingArea`, and should
not mutate any existing board path `d` for that local stroke.

On release:

- Call `move()` once as today to include the release point.
- Create the real board path once and set the final path data.
- Clear the overlay.
- Release interaction leases.

On abort/cancel/rejection/disconnect:

- Clear overlay.
- Drop active path cache and remove any materialized local path if one exists.
- Release interaction leases.

### Phase 5: RAF coalescing

After the overlay exists, avoid redundant overlay updates:

- Pencil append still sends the live socket message immediately.
- Local active append updates only JS path cache and the overlay.
- Overlay renderer flushes at most once per animation frame.
- If multiple points arrive before the frame, only the latest path data is
  rendered in the overlay.

Do not coalesce network writes in this phase. Keep behavior and rate-limit
semantics unchanged.

Expected impact:

- Medium.
- Small code footprint because the helper stays inside Pencil's tool module.

### Phase 6: Protocol batching: do not do it now

If remote peers remain slow after local overlay work, batch pencil appends.

Scope:

- Add a live pencil batch shape that can carry multiple child points.
- Reuse existing batch concepts where possible.
- Update server validation, board apply logic, replay, optimistic invalidation,
  and tests.

Why later:

- It touches protocol shape and hot server validation paths.
- It affects persistence/replay correctness.
- It is valuable for multi-user boards, but not required to fix local input
  responsiveness.

Expected impact:

- High for remote peers and server fan-out.

Risk:

- Medium-high.

### Phase 7: Remote active-stroke overlay, only after batching: do not do it now

If peers still suffer from visible path mutation while receiving someone else's
stroke, add a remote overlay concept:

- Render remote active pencil strokes in overlays.
- Commit to board SVG on stroke-end or idle timeout.
- Requires an explicit or inferred stroke lifecycle.

Risk:

- High without a clean stroke-end protocol.
- Do not do this before local overlay and batching prove insufficient.

## Regression testing strategy

The tests should catch the slow architecture being reintroduced without relying
on exact milliseconds. Use three layers.

### 1. Unit-level lease cleanup tests

Add Node/browserless tests around runtime/tool behavior where possible:

- Pencil press acquires an interaction lease.
- Release, cancel, mutation rejection, socket disconnect, and tool switch
  release the lease.
- Releasing twice is safe.
- Tool A cannot release Tool B's lease through the tool runtime facade.
- Active local Pencil create/append messages update only JS path state plus the
  live overlay; they do not add or mutate a local stroke under `#drawingArea`
  until release.
- A rejected Pencil append discards the whole local stroke and emits at most one
  cleanup delete.

These tests are deterministic and cheap.

### 2. Playwright visible behavior

Add focused Playwright coverage for user-visible Pencil behavior.

Setup:

- Navigate to the board, wait for ready/socket writable, select pencil.
- Draw an active pencil stroke through normal pointer input.

Assertions while the stroke is active:

- A visible path exists under the board with the expected stroke color,
  non-empty `d`, and expected stroke width.
- The assertion should be phrased as visible user output, not as knowledge of
  the live overlay or any closed/internal UI subtree.

Assertions after release:

- The final board path is visible.
- Cursor suppression is cleared.
- The final path persists as today.

The structural performance invariant belongs in Node/browserless tests where it
can inspect tool state without making browser tests depend on implementation
details.

### 3. Optional relative browser-health smoke

Use Playwright's `page.evaluate()` to run a small in-page metric collector during
the scripted stroke:

- `PerformanceObserver` for `longtask` entries when available.
- RAF tick count and max RAF gap as diagnostic attachments, not primary strict
  pass/fail numbers.
- Mutation counters from the structural invariant as the primary pass/fail
  signal.

If a relative assertion is desired, compare empty-board and large-board runs in
the same test process and assert the large-board stroke does not produce many
more long tasks than the empty-board stroke. Keep this threshold generous and
secondary; the deterministic mutation invariant should carry the test.

Avoid default CI assertions like "stroke must finish in < N ms". Shared CI
hardware makes that flaky.

### 4. Local deep profiling path

Keep Chrome/Playwright tracing as a manual diagnostic, not a CI gate:

- Playwright can evaluate browser-side scripts with `page.evaluate()`.
- Playwright tracing captures browser operations and network activity, useful
  for debugging failures.
- Chromium-only CDP sessions are available through
  `browser.newBrowserCDPSession()` if a future diagnostic script needs raw
  Chrome performance traces.

Do not parse full DevTools traces in normal CI unless the lightweight tests miss
real regressions.

## Suggested file changes by phase

Phase 1:

- `client-data/js/board_full_runtime_modules.js`
- `client-data/js/board_runtime_core.js`
- `client-data/js/board_tool_registry_module.js`
- `types/app-runtime.d.ts`
- `client-data/board.css`
- targeted Node tests

Phase 2:

- `client-data/tools/pencil/index.js`
- pencil-specific cleanup tests

Phase 3:

- `client-data/tools/cursor/index.js`
- `client-data/js/board_presence_module.js`
- `client-data/board.css`
- presence/cursor tests

Phase 4:

- `client-data/tools/pencil/index.js`
- `client-data/tools/pencil/pencil.css`
- Playwright large-board structural performance spec

Phase 5:

- `client-data/tools/pencil/index.js`

Phase 6+:

- only after measurement justifies protocol changes

## Rollout order

1. Add interaction leases and cleanup tests.
2. Use the lease for own-cursor suppression only.
3. Make presence rendering coalesced and idle-safe.
4. Add the pencil live overlay with one final board-SVG commit on stroke end.
5. Make the overlay SVG Pencil's tool-lifetime hit-test surface with
   `pointer-events: bounding-box`.
6. Add Playwright visible-behavior coverage and Node structural tests.
7. Measure local trace again on the same dense board.
8. Consider protocol batching only if remote-peer traces still show repeated
   large-SVG paint/layerize during incoming pencil strokes.

## Source notes

- Chrome RenderingNG architecture:
  https://developer.chrome.com/docs/chromium/renderingng-architecture
- Local Chromium geometry notes:
  `/home/ophir/Downloads/Web page geometries.md`
- Playwright `page.evaluate()` runs code in the browser page environment and can
  return results to the test:
  https://playwright.dev/docs/evaluating
- Playwright tracing is useful for debugging but should generally be configured
  through Playwright Test rather than used as a normal assertion mechanism:
  https://playwright.dev/docs/api/class-tracing
- Playwright Chromium CDP sessions are available but Chromium-only:
  https://playwright.dev/docs/api/class-browser
- SVG 2 `pointer-events` applies to container elements and includes
  `bounding-box`:
  https://www.w3.org/TR/SVG/interact.html#PointerEventsProperty
