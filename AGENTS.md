# Working on WBO

WBO is a collaborative SVG whiteboard. Read [ARCHITECTURE.md](./ARCHITECTURE.md)
for system boundaries and [README.md](./README.md) for running an instance.

## Engineering decisions

- Keep changes readable and scoped to the problem. Prefer a direct function or
  plain data over a new framework, factory, class hierarchy, or registry.
- Add an abstraction when it removes demonstrated duplication or isolates an
  independently changing responsibility. Explain the benefit in the change.
- Keep each rule in one owner. Reuse shared contracts instead of copying tool,
  permission, validation, or configuration logic between client and server.
- Remove unused internal APIs and obsolete compatibility paths when changing
  their owner. Preserve supported wire and stored-data compatibility.
- Validate hostile HTTP/socket inputs at the boundary. Reject malformed input
  deterministically without crashing. Client clamping never replaces validation.
- Read environment configuration at startup and pass dependencies explicitly.
  Do not add configuration caches or test-only reset layers.

## Documentation

- README owns setup and operations; ARCHITECTURE owns boundaries, data flow, and
  the reasons for major design choices; this file owns contributor policy.
- Before editing docs, honestly assess whether the task changes something future
  readers need to understand or operate the system. Many tasks need no doc update.
- Add documentation only by removing or refactoring genuinely less important
  material. Keep the documentation footprint flat or smaller; moving text to
  another file or tightening formatting does not count as a meaningful cut.
- Keep ARCHITECTURE clear and readable in one sitting. Explain boundaries, flow,
  and rationale; link to owners for field lists, algorithms, and UI details.
- Correct existing guidance when documented behavior changes. Keep implementation
  detail in code and focused tests, and comments about non-obvious constraints.

## Correctness and performance

- Persistent writes go through admission, the per-board session, mutation
  application, replay logging, and sequenced broadcasts. Cursors stay ephemeral
  and must not grow board extent.
- The write runtime owns messages after send/draw/buffer submission; callers
  must not mutate them afterward.
- Stored SVG is authoritative. Preserve replay consistency, atomic batches,
  stale-writer protection, and structural validation. Invalid items may be skipped;
  failed loads reject. Preserve recovered empty SVGs alongside quarantine history.
  Never silently repair broken document structure.
- Keep structural scanning, summary decoding, and full geometry separate.
  Board load/save/copy must not hydrate all Pencil points or read source SVG
  from live socket handling.
- Protect pan-ready boot: render chrome before streamed SVG and defer full
  runtime/tool imports until the viewport is usable. Consider every new import
  on that path.
- Keep viewport/extent logic in its existing owners and tool-specific behavior
  in the tool. Measure SVG geometry only for small interaction selections.
- Avoid per-coordinate allocations, config reads, and tracing spans. Measure
  suspected throughput changes; do not optimize from intuition alone.

## Frontend

- Preserve the compact whiteboard shell and unobstructed left tool rail. Use
  existing CSS and controls before adding a visual convention.
- Use white/near-white surfaces, thin cool-gray borders, muted green accents,
  tight radii (2px controls, 4px panels), and compact type (13px primary).
- Hide idle status. Scale-disabled tools remain selectable and explain why
  drawing is blocked.
- Localize user-visible strings through `Tools.i18n`; add natural, contextual
  translations in **every** supported language in
  [translations.json](./server/http/translations.json).
- Use the shared tool manifest, message metadata, rate-limit math, and moderation
  rules; do not recreate their lists in UI or server code.
- Keep moderation (`canBan`) and destructive editing (`canClear`) checks distinct.

## Validation

[CI](./.github/workflows/CI.yml) and [package.json](./package.json) own the check
definitions. Install with `npm ci` (Node 22+).

`npm test` runs Node tests, Playwright, and Biome lint. `npm run typecheck` is
separate. Use the package scripts to target affected tests and benchmarks.

- Run checks relevant to the change; run `npm test` and typecheck for changes
  spanning client/server boundaries. Report failures and environmental limits.
- Before adding tests, identify a plausible regression, assess existing coverage,
  and weigh protection against long-term maintenance cost. Extend focused tests
  when sufficient. Add coverage for meaningful gaps, especially at trust and
  persistence boundaries; routine refactors and implementation mirrors rarely
  deserve new tests.
- Assert authoritative app/socket state in browser tests; avoid sleeps and fix
  application races before adding test workarounds. Install Chromium with
  `npx playwright install chromium` if needed.
- Benchmark before and after hot-path, persistence, replay, or broadcast changes.
  Profile with `npm run profile -- <scenario>` only to investigate a regression.
- Keep production drawing data out of fixtures and leave unrelated local edits
  intact.
