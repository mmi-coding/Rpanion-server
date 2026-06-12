# UI Guidelines — Self-Documenting Pages

**Rule (applies to all future UI development in this fork):** every page must be
understandable without leaving the webUI. No control may rely on external docs to
explain what it does or what to put in it. The webUI is operated in the field, on
a phone, with no manual at hand — the explanation lives next to the control.

## The two building blocks

Both live in [`src/components/Help.jsx`](../src/components/Help.jsx).

### `<HelpTip text="..." />` — per-control tooltip

A small "?" marker rendered inside the control's `<label>`. Shows a tooltip on
hover, keyboard focus (it is focusable) or tap.

```jsx
import { HelpTip, HelpSection } from './components/Help.jsx';

<label className="col-sm-3 col-form-label">APN
    <HelpTip text="Your carrier's access point name. Applied before a reconnect (AT+CGDCONT); leave empty to keep the modem's stored APN" />
</label>
```

Writing the text:

- Say **what the control does** and **what to put in it** — include a concrete
  example value or the common default ("usually /dev/ttyUSB2", "1500 fits most
  radios").
- Mention **when it takes effect** if it isn't immediate ("applies when the
  stream is next started").
- One to three sentences. Plain text only (it renders inside a Bootstrap
  `Tooltip`); no JSX, no line breaks.
- `placement` defaults to `right`; override only if the tooltip would clip.

### `<HelpSection title="...">` — per-page/per-section collapsible explanation

A collapsed-by-default block ("▸ How this works") holding the longer story:
architecture, behaviour rules, tables, multi-step flows. Full JSX is allowed
inside (lists, `<code>`, `<Table>`).

```jsx
<p><i>One-sentence summary of what the page is for.</i></p>
<HelpSection title="How camera switching works">
    <ul>
        <li>...</li>
    </ul>
</HelpSection>
```

## The page pattern

1. **Title** (`renderTitle()`).
2. **One short italic sentence** — what the page is for. This is the only
   always-visible prose.
3. **`<HelpSection>`** directly under it — the full explanation, collapsed.
   Long sections within a page (e.g. "Modem discovery", "Connection test") get
   their own `HelpSection` under their `<h2>`.
4. **Every form control's label gets a `<HelpTip>`.** No exceptions — if a
   control needs no explanation, it probably needs a better label instead.

## What NOT to do

- **No paragraphs of always-visible explanatory prose.** That content belongs in
  a `HelpSection`. Pages must stay compact for field use.
- **No verbose `<small className="form-text text-muted">` under fields.** That
  text moves into the field's `HelpTip`. Keep `<small>` only for *contextual
  diagnostics that depend on runtime state* (e.g. "no modem interface found
  usually means..." shown after a scan) — i.e. text the user needs pushed at
  them at that moment, not reference text.
- **Don't duplicate**: if the HelpSection already explains a rule, the HelpTip
  on the related field can just point at it ("see the rules above").

## Scope

This rule applies to **all pages added or substantially modified by this fork**
(`cameraswitcher.jsx`, `pipelineeditor.jsx`, `ltemodem.jsx`,
`cellulartuning.jsx`, and anything new). Upstream pages are left untouched to
keep the merge surface with `stephendade/Rpanion-server` small — retrofit an
upstream page only when a fork feature already has to modify it anyway.

## Testing

Frontend tests render pages with vitest + jsdom. `HelpSection` content is in the
DOM even when collapsed (`react-bootstrap` `Collapse` renders hidden), so text
assertions work without simulating a click. `HelpTip` markers are
`aria-label="help"` spans — `getAllByLabelText('help')` counts them.
