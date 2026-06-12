# Feature 7 report: Self-documenting webUI (tooltips + collapsible help)

**Branch:** `feature/self-documenting-ui` (commit `11bc465`), merged `--no-ff` into `dev` (`98175f9`)
**Status:** complete, WSL-verified; one visual item deferred (no browser available in WSL)
**Docs:** `docs/UI-GUIDELINES.md` (the rule itself) · `CLAUDE.md` (repo-root conventions, new)

## What was built

A standing rule — **every fork page must explain itself in place** — plus the
components to implement it and a retrofit of all four fork pages:

- **`src/components/Help.jsx`**
  - `HelpTip` — a focusable "?" marker inside a control's label; tooltip on
    hover, keyboard focus or tap (react-bootstrap `OverlayTrigger`/`Tooltip`)
  - `HelpSection` — a collapsed-by-default "▸ How this works" block for the
    longer story (react-bootstrap `Collapse`); full JSX allowed inside
- **Page pattern**: one short italic intro sentence → `HelpSection` with the
  full explanation → a `HelpTip` on *every* form control's label. Verbose
  `<small>` under-field text was absorbed into the tooltips; `<small>` remains
  only for runtime-state-dependent diagnostics (e.g. the post-scan
  no-modem-interface hint on the LTE page).
- **Retrofitted pages**: Camera Switcher (12 tooltips + switching-modes/RC
  semantics section), Video Pipeline Editor (3 tooltips + pipeline-rules
  section: `pay0`, udpsink auto-append, `enc0`, validation/fallback),
  LTE Modem (7 tooltips + 3 sections: link architecture/no-ModemManager,
  what the scan does, what the connection test checks), Cellular Video
  Tuning (3 tooltips + adaptive-bitrate section with the RSRP tier table).
- **The rule, recorded twice**: `docs/UI-GUIDELINES.md` (pattern, writing
  guidance for tooltip text, anti-patterns, scope, testing notes) and a new
  repo-root `CLAUDE.md` (fork conventions: hard constraints, UI rule, git
  workflow, CI parity) so every future session/contributor sees it.

**Scope**: fork-added/-modified pages only. Upstream pages are untouched to
keep the merge surface with `stephendade/Rpanion-server` small.

## How it was tested (WSL)

CI parity green: `npm run lint` (0 errors), `rm -f ./config/settings.json &&
npm run build && npm run testback` → **145/145**, `rm -f ./config/settings.json
&& npm run testfront` → **16/16** (1 new).

New frontend test (`App.test.jsx`): renders `HelpTip` + `HelpSection` directly —
asserts the `aria-label="help"` "?" marker, that section content is present in
the DOM while collapsed (`aria-expanded="false"`), and that clicking the title
expands it. The four page-level smoke renders exercise every retrofitted page
with the new components.

## Needs visual verification (any desktop browser, or on-device)

No working browser exists in this WSL box (chromium is a broken snap), so the
behaviour is unit-tested but not eyeballed. One pass over the four pages:

- tooltips appear on hover *and* keyboard focus, don't clip at viewport edges
  (HelpTip `placement` defaults to `right`)
- HelpSections expand/collapse smoothly; tier table renders inside the
  Cellular Tuning section
- pages read compact with sections collapsed on a phone-sized screen (the
  field-use case that motivated the rule)
