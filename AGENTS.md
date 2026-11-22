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

- Preserve WBO's mark unless explicitly asked to rebrand. Reuse controls and keep
  the compact left rail unobstructed.
- Use white or near-white surfaces, thin cool-gray borders, muted green accents,
  13px primary type, 2px control radii and 4px panel radii.
- Check silhouettes, spacing and strokes at the smallest display size. UI icons
  inherit `currentColor` from shared CSS variables in every state.
- Hide idle status. Keep scale-disabled tools selectable and explain the limit.
- Localize naturally through `Tools.i18n` in every [supported language](./server/http/translations.json).
- Share the tool manifest, message metadata, rate limits and moderation rules.
  Keep `canBan` distinct from `canClear`.

## Validation

[CI](./.github/workflows/CI.yml) and [package.json](./package.json) own checks and
Node requirements. Install with `npm ci`; `npm test` runs Node tests, Playwright,
and Biome. Typecheck is separate.

- Run checks relevant to the change; run `npm test` and typecheck for changes
  spanning client/server boundaries. Report failures and environmental limits.
- Deploy only through the GitHub release workflow. Bump the package and lockfile
  patch version for every release.
- Name the failure a test must detect. Prefer extending existing coverage; keep
  fixtures, helpers, and assertions only when protection justifies maintenance.
- Before committing, ask what could be completely broken while tests pass.
  Verify the user outcome across affected environments; for UI/rendering changes,
  inspect headless browser screenshots. Report material gaps.
- Assert authoritative app/socket state; avoid sleeps and fix application races.
- Benchmark before and after hot-path, persistence, replay, or broadcast changes.
  Profile with `npm run profile -- <scenario>` only to investigate a regression.
- Keep production drawing data out of fixtures; preserve unrelated local edits.
