# Backend TypeScript migration (2026-06)

Migrated the entire backend (`server/` + `mavlink/`, 43 source files, ~9k LOC)
from JavaScript to TypeScript — the **gradual/loose** Phase 1: every file is
`.ts` and type-checked, with untyped boundaries left `any` for now. Driven by a
multi-agent design workflow (model-tiered), then executed inline in
dependency-ordered, individually-gated waves. Both suites held
**100/100/100/100** throughout; e2e 68; lint + typecheck clean.

This was the alternative recommended over a Rust rewrite: the backend is
I/O-bound glue, so Rust's strengths don't address a real bottleneck, whereas TS
gives type-safety/maintainability incrementally without throwing away the
100%-covered test suite.

## Toolchain (Wave 0)

- **`tsconfig.json`** — `allowJs`, `strict:false`, CommonJS/ES2022, **emit-in-place**
  (`outDir:"."`) so the `.deb`/systemd/`paths.js` layout stays byte-identical. A
  `ts-node` block (`transpileOnly` + `ignore: \.js$`) so ts-node transcompiles
  only `.ts` and leaves `.js` to Node — without this, `allowJs` made ts-node
  transpile the JS too and nyc's branch count silently shifted.
- **Tests** transpile `.ts` in-memory via `ts-node/register` (`.mocharc.json`);
  nyc maps coverage to `.ts` source. No compile-before-test (would map coverage
  to emitted JS).
- **Dev/e2e** run `node -r ts-node/register server/index.ts`.
- **Production** — `build:server` (`tsc`) runs in `build-deb.sh` before `node-deb`,
  emitting runnable `.js`; the daemon entry stays `./server/index.js`. **No
  `ts-node` ships to the Pi.** Emitted `.js`/`.js.map` are gitignored build
  artifacts (never committed — else nyc `all:true` double-counts `foo.ts`+`foo.js`).
- Ambient shims (`typings/`) for `settings-store`, `ntrip-client(+ecef)`,
  `ntrip-decoder`, and an Express `Request.user` augmentation; external `@types`
  + `typescript-eslint` added.

## Waves (each its own covback-gated commit/wave)

0. Toolchain bootstrap (no source converted) — proves ts-node/nyc unchanged on JS.
1. Pilot — `videostreamHelpers.ts` (proves the end-to-end loop).
   *prep:* normalized 61 relative `require('./x.js')`→`require('./x')` so every
   later conversion is a clean `git mv` (no consumer/test breakage).
2. 5 leaves · 3. 9 simple managers · 4. 9 complex managers (incl. videostream,
   flightController, mavManager) · 5. auth + 17 route factories · 6. `index.ts`.

## Conversion recipe

`git mv` + `module.exports = X` → `export = X` (module marker; also fixes the
global-scope `const fs` redeclare) + declare class fields (TS requires them; a
typecheck-driven helper auto-declared 150+ as `any`). Import not-yet-converted
`.js` deps via `require()` to avoid TS5055 (`outDir:"."` can't overwrite an
imported `.js`). `index.ts` dual-export rewritten to `(app as any).testHooks={}`
+ `export = app`.

## Gotchas caught by the gates

- ts-node transpiling `.js` (allowJs) → nyc branch count shifted → scoped ts-node
  to `.ts` only.
- TS5055 (emit would overwrite an imported `.js`) → `require()` for `.js` deps.
- A **trailing** `// istanbul ignore next` (mavManager) stopped applying after
  ts-node relocated it → moved to its own line.
- `src/App.test.jsx` imported + rendered the **backend** `pppConnection` class
  (`<PPPConnection/>`) — unloadable in vitest once `.ts`; pointed it at the real
  frontend `ppp.jsx` (already covered by `ppp.test.jsx`).
- Dev/e2e entry + node_deb daemon path: dev points at `index.ts`, the package
  keeps the compiled `index.js`.

## Verification

`npm run lint` clean, `npm run typecheck` clean, `npm run build` OK,
`build:server` compiles all 43 (the compiled `index.js` loads with `testHooks`),
`covback` 947 passing 100/100/100/100, `covfront` 814 passing 100/100/100/100,
`npm run e2e` 68 passed.

## Follow-on (not done here)

Strictness ramp — enable `strictNullChecks`, then `noImplicitAny`, per file,
replacing the `any` boundaries with real types and switching `require()` of
now-`.ts` deps to typed `import`. This is the second, separate campaign; Phase 1
deliberately stops at "all `.ts`, compiling, 100% green."
