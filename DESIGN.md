---
name: VapourSynth WebAssembly — Broadcast Mixer
description: Keyboard-first graphite control desk for routing a real VapourSynth frame pipeline in the browser.
colors:
  bg: "#0d0e10"
  surface-0: "#131418"
  surface-1: "#17181d"
  surface-2: "#1d1f25"
  field: "#0e0f12"
  screen: "#0b0c0e"
  line: "rgba(255, 255, 255, 0.075)"
  line-strong: "rgba(255, 255, 255, 0.14)"
  text: "#e8e6e2"
  text-2: "#a3a8b0"
  text-3: "#838a94"
  amber: "#eaa33c"
  amber-bright: "#f6ba58"
  amber-ink: "#201505"
  amber-dim: "rgba(234, 163, 60, 0.16)"
  amber-paper: "#f4e3c8"
  error: "#f07c72"
  error-dim: "rgba(240, 124, 114, 0.15)"
  lamp-idle: "#555b64"
typography:
  display:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace"
    fontSize: "clamp(1.5rem, 2.4vw, 2.1rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace"
    fontSize: "0.7rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
  label:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace"
    fontSize: "0.68rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.1em"
  body:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.6
  code:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace"
    fontSize: "0.7rem"
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace"
    fontSize: "0.64rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  xs: "0.25rem"
  sm: "0.3rem"
  md: "0.4rem"
  lg: "0.5rem"
  pill: "999px"
spacing:
  xs: "0.4rem"
  sm: "0.6rem"
  md: "0.85rem"
  lg: "1rem"
  xl: "1.1rem"
components:
  panel:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.lg}"
  run-button:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.amber-ink}"
    rounded: "0.35rem"
    height: "2.4rem"
    padding: "0.45rem 0.7rem 0.45rem 0.9rem"
  bus-node:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0.75rem 0.9rem"
  bus-node-active:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.amber-paper}"
    rounded: "{rounded.md}"
    padding: "0.75rem 0.9rem"
  param-input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    width: "6.2rem"
    padding: "0.38rem 0.5rem"
  output-state:
    backgroundColor: "rgba(255, 255, 255, 0.02)"
    textColor: "{colors.text-2}"
    rounded: "{rounded.pill}"
    padding: "0.32rem 0.6rem"
  graph-status:
    backgroundColor: "transparent"
    textColor: "{colors.amber}"
    rounded: "{rounded.pill}"
    padding: "0.28rem 0.55rem"
  script-editor:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "0"
    padding: "1rem 1.1rem"
---

# Design System: VapourSynth WebAssembly — Broadcast Mixer

## Overview

**Creative North Star: "The Night Control Room"**

This is a broadcast production desk, not a code editor with a preview attached. The workspace is a night control room: graphite equipment surfaces stacked in a rack, a dominating Program monitor, a literal signal bus carrying Source → Invert → Program Output, a focused parameter inspector, and the `.vpy` script as a technical record rather than the primary composition. Signal amber is the only active-route accent; everything at rest is graphite, hairline-divided, and lit like an idle broadcast suite awaiting a take.

Density is high and uniform. Every label is a small uppercase, letter-spaced engraving; every real value, expression, and code sample is verbatim monospace text on a dark field. Depth comes from tonal layering of graphite surfaces and dark ambient shadow, never from color. The world is deliberately quiet: no gradients of hue, no display faces, no decorative illustration — the frame output and the amber route are the only things allowed to glow.

Motion is a state language, not decoration: 130ms ease transitions for route selection, a single pulse animation for "rendering" states, everything suppressed under `prefers-reduced-motion`. Keyboard operation is first-class — every bus stage is a real button, focus is always a 2px amber ring, and status is announced with `aria-live`.

**Key Characteristics:**
- Graphite equipment racks: dark neutral surfaces (#131418 family) with 1px white hairlines (7.5% / 14% alpha) and 0.5rem-radius corners.
- Signal amber (#eaa33c) as the sole active-route accent — selection, route links, lit lamps, focus rings, carets, and the Run action.
- Monospace-only typography, from the 0.64rem captions to the clamp(1.5rem, 2.4vw, 2.1rem) statement line.
- A visible signal bus: three selectable stage nodes joined by amber arrows, not abstract tabs.
- Status lamps everywhere: small circles with translucent halos that switch idle gray → amber → error red.
- Flat at rest, dark ambient shadows only; amber appears as a ring or halo, never a glow field.

## Colors

A two-voice palette: graphite neutrals carry all resting structure and text; signal amber carries every active or routable state. Error red is the single exception, reserved for failed states.

### Primary
- **Signal Amber** (#eaa33c): the active-route accent. Appears as the selected bus node's border and lamp, the bus link lines and arrowheads, lit output/runtime status lamps, focus outlines (2px), selection highlight (`amber-dim`), the input caret, and the Run button gradient. It is always small and structural — borders, lamps, rings — never a painted field.
- **Signal Amber Bright** (#f6ba58): the top stop of the Run button gradient (180deg `#f6ba58` → `#eaa33c`), the button's focus ring, and the skip-link's ring.
- **Amber Ink** (#201505): the text color on amber — Run button label, keycap glyphs. Dark enough for AA on both amber stops.
- **Signal Amber Wash** (rgba(234, 163, 60, 0.16)): translucent amber for halos, the selected node's 1px ring (`box-shadow: 0 0 0 1px`), text selection, and the "READY" pill border.
- **Amber Paper** (#f4e3c8): the stage name text of a selected bus node — warm ivory proof that the route is lit.

### Neutral
- **Control Room Black** (#0d0e10): page background and `theme-color`; body also carries a top-center radial glow (rgba(255,255,255,0.045)) fading over a 180deg gradient from #101114 to #0d0e10 at 26rem.
- **Graphite Panel** (#131418): all equipment surfaces — monitor, bus, inspector, script, diagnostics.
- **Graphite Raised** (#17181d): bus node bases, the brand mark's gradient bottom.
- **Graphite Highlight** (#1d1f25): bus node gradient tops; the lightest surface in the system.
- **Field Charcoal** (#0e0f12): recessed wells — numeric inputs and the script textarea, darker than the panels that hold them.
- **Monitor Void** (#0b0c0e): the Program monitor screen, with a 1.4rem grid of 2%-white lines, a faint radial center glow, and a heavy inset vignette.
- **Ivory** (#e8e6e2): primary text — headings, stage names, field values, code.
- **Ash** (#a3a8b0): secondary text — panel titles, labels, summaries, runtime status, diagnostic log.
- **Slate** (#838a94): tertiary text and metadata — panel indexes, units, captions, file tags, notes, placeholder body.
- **Hairline** (rgba(255,255,255,0.075)): all resting dividers and panel borders; also the build tag border.
- **Hairline Strong** (rgba(255,255,255,0.14)): interactive borders — bus nodes, inputs, file tags, status pill borders, clear button.
- **Idle Lamp** (#555b64): every unlit status lamp, with a white halo at 5% alpha; brightens to #8b919b on node hover.

### Tertiary
- **Fail Red** (#f07c72): error states only — error output/runtime lamps and halos (rgba(240,124,114,0.15)). The diagnostics log writes errors in #ff9a9a and warnings in #e9c46a.

### Named Rules
**The Signal Amber Rule.** Amber is the sole active-route accent. Its legal appearances are: the selected bus node (border, lamp, ring, name), bus links, lit status lamps, focus outlines, the caret, text selection, and the Run action. Anything else in amber is a routing violation.

**The Fail Red Rule.** Red means "the run failed" — nothing else. Idle and ready states are gray and amber; red never decorates, it only reports.

## Typography

**Display Font:** system monospace stack — ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono" (one stack for everything).
**Body Font:** the same monospace stack.
**Label/Mono Font:** the same monospace stack.

**Character:** instrument-panel engraving. There is exactly one font family; hierarchy is made entirely from size (0.64–0.85rem micro-scale), weight (400/600), uppercase transforms, and letter-spacing (0.06–0.14em). Numbers are tabular by nature of the family and right-aligned in fields; real code stays verbatim, including `tab-size: 2` in the editor.

### Hierarchy
- **Display** (600, clamp(1.5rem, 2.4vw, 2.1rem), 1.15, -0.01em): the single page statement, "Route a real frame pipeline at the desk."
- **Title** (600, 0.7rem, 1, 0.14em, uppercase): every panel header — Program monitor, Signal bus, Inspector, Script record.
- **Label** (600, 0.68rem, 1, 0.1em, uppercase): field labels (Width / Height) and node-info keys; stage names step up to 0.72rem / 0.13em; the inspector target reads 0.68rem / 0.12em in amber.
- **Body** (400, 0.85rem, 1.6): the lede paragraph (max-width 46rem); detail values sit at 0.76rem / 1.55, runtime status at 0.74rem / 1.45, summaries at 0.7rem / 1.6.
- **Code** (400, 0.7rem, 1.55): bus node code lines at 0.66rem / 1.5 with `overflow-wrap: anywhere`; the script editor at 0.78rem / 1.7 with `tab-size: 2`; inline `code` in the lede at 0.8em on a 5%-white chip.
- **Caption** (400, 0.64rem, 1, 0.04–0.08em): panel indexes ("01"), monitor tag ("OUT 0"), units ("px"), screen caption, file tag, keycap glyphs; the build tag runs 0.64rem / 0.14em.

### Named Rules
**The Monospace-Only Rule.** Every glyph on the surface is the mono stack — headings, labels, values, and code alike. A proportional or display face is off-world; when something must stand out, it earns size, weight, or amber instead.

**The Engraving Rule.** Labels are engraved, not written: uppercase, 600 weight, 0.1em+ letter-spacing, and never larger than 0.72rem. Title case and sentence case belong to code and to the page statement only.

## Layout

A rack, not a canvas. The shell is centered at `width: min(92rem, calc(100% - 2rem))` with 1.1rem top and 2.4rem bottom padding. The console is a two-column grid — `grid-template-columns: minmax(0, 2fr) minmax(17rem, 1fr)` with a 0.85rem gap — and every region is a full panel: Program monitor (row 1) and Signal bus (row 2) on the program side; Inspector spans both rows in the 17rem rail (row 1 / span 2); Script record (row 3) and Runtime diagnostics (row 4) run full-width beneath.

- Spacing rhythm is a rem-based micro-scale: 0.4rem (lamp gaps, tight chip padding), 0.6rem (interior field gaps), 0.85rem (console gap), 1rem (panel padding, action bar), 1.1rem (shell gutters). Panel heads are a 2.9rem min-height strip with 0.9rem side padding.
- The monitor screen is `min-height: clamp(15rem, 24vw, 22rem)` with `clamp(0.9rem, 2.2vw, 1.8rem)` padding; the canvas is centered, `max-width: 46rem`, and `image-rendering: pixelated` — frames stay crisp, never smoothed.
- **≤56rem** (narrow): single column in DOM order — monitor → signal bus → inspector → script → diagnostics. The bus row becomes a vertical chain: nodes full-width, links rotate to 2px vertical lines with amber triangle heads (7px border trick). The action bar stacks.
- **≤28rem** (compact): the build tag and keycap hints are hidden.
- Focus order, DOM order, and visual order stay identical in every layout; the skip link jumps straight to the Program monitor.

## Elevation & Depth

Flat graphite with tonal layering. Depth is built from surface lightness (Panel #131418 → Raised #17181d → Highlight #1d1f25), recessed wells (#0e0f12), and dark ambient shadow — never from colored shadows or blurry elevation. Amber contributes exactly one ring and one halo to the active route, which is how selected state reads as "lit" rather than "lifted". The body page itself gets a faint top-center light bloom (radial white at 4.5%) to mimic a control room wash.

### Shadow Vocabulary
- **Panel drop** (`0 0.4rem 1.6rem rgba(0, 0, 0, 0.22)`, plus `inset 0 1px rgba(255, 255, 255, 0.03)`): resting depth under every equipment panel.
- **Frame drop** (`0 1rem 2.6rem rgba(0, 0, 0, 0.5)`): the rendered canvas floats deepest, under the monitor.
- **Screen vignette** (`inset 0 0 2.5rem rgba(0, 0, 0, 0.45)`, plus a 1px inset white ring at 5%): the monitor's recessed glass.
- **Route ring** (`0 0 0 1px rgba(234, 163, 60, 0.16)`): the selected bus node's amber seat.
- **Lamp halo** (`0 0 0 0.18rem <dim-wash>`): every status lamp's glow; white 5% when idle, amber wash when ready, red wash on error.

### Named Rules
**The Flat-At-Rest Rule.** Panels are flat at rest. The only allowed shadows are the dark ambient panel/frame drops and inner highlights; the only colored "shadow" in the system is the amber route ring and lamp halos on the active route.

## Shapes

Equipment modules with hairline seams and modest corners. Panels use 0.5rem radius, bus nodes 0.4rem, controls and tags 0.3rem (inputs, file tags, clear button, skip link), the Run button and brand mark 0.35rem, keycaps 0.25rem, inline code 0.2rem, and status pills a full 999px capsule. Every module is outlined by a 1px hairline (7.5% white resting, 14% white interactive) — borders, not fills, define the furniture.

The recurring silhouette is the status lamp: a 0.4–0.46rem circle with a 0.18rem translucent halo ring (`box-shadow: 0 0 0 0.18rem`), shared by output state, bus nodes, runtime status, and the diagnostics summary. The signal bus draws its own geometry: a 2px amber line with a rotated-square arrowhead (0.5rem square, `transform: rotate(-45deg)`), which becomes an amber triangle on narrow screens. The brand mark is a 1.7rem square with a 145deg graphite gradient and an amber-dim border.

## Components

### Panels
- **Shape:** 0.5rem radius, 1px hairline border (7.5% white), `overflow: hidden`.
- **Background:** Graphite Panel (#131418) with the panel drop shadow and inner top highlight.
- **Header:** 2.9rem min-height strip with 0.9rem side padding, hairline bottom border, and a near-invisible white gradient (2.8% → 0.8%). Left to right: panel index ("01", slate, 0.64rem), uppercase title (ash, 0.7rem / 0.14em), then a right-aligned meta slot — monitor tag, inspector target, file tag, status pill.

### Signal Bus Nodes
- **Character:** the signature component — each stage of Source → Invert → Program Output is a selectable equipment card with its own lamp and its real code engraved beneath.
- **Shape:** 0.4rem radius, 1px strong hairline (14% white), gradient background (Highlight #1d1f25 → Raised #17181d), padding 0.75rem 0.9rem, internal gap 0.42rem.
- **Resting:** slate code line (0.66rem / 1.5), idle gray lamp; hover raises the border to 26% white and the lamp to #8b919b.
- **Active (`aria-pressed="true"`):** amber border, amber seat ring, amber lamp with halo, stage name in Amber Paper (#f4e3c8), and a 9%→3% amber wash layered over the graphite gradient.
- **Focus:** 2px amber outline, 2px offset. Transitions are 130ms ease on border-color, background, and box-shadow.

### Run Button
- **Shape:** 0.35rem radius, 1px #f0b055 border, 2.4rem min-height, padding 0.45rem 0.7rem 0.45rem 0.9rem.
- **Primary:** the only amber-filled control — 180deg gradient Bright #f6ba58 → Signal Amber #eaa33c, Amber Ink (#201505) label at 0.78rem / 600 / 0.06em, with the keycap hint ("Ctrl / ⌘ ↵") etched in translucent amber ink.
- **Hover / Active:** `filter: brightness(1.07)` on hover; 1px translateY on press. **Focus:** 2px #f6ba58 outline at 3px offset.
- **Disabled:** 40% opacity, `saturate(0.25)` — the desk visibly powers down.

### Numeric Fields
- **Style:** 6.2rem wide, 1px strong hairline (14% white), 0.3rem radius, Field Charcoal (#0e0f12) well, 0.78rem right-aligned value, slate unit ("px") beside the label.
- **Label:** uppercase, 0.68rem / 600 / 0.1em, ash.
- **Focus:** 2px amber outline at 2px offset plus amber border; caret is amber; hover border 24% white. Adjacent fields are separated by 7.5% hairlines.

### Status Pills
- **Style:** 999px capsule, 0.32rem 0.6rem padding, 1px strong hairline on a 2%-white fill, ash text 0.68rem.
- **Lamp:** 0.44rem circle with 0.18rem halo — idle #555b64 (white 5% halo), ready amber (amber wash halo), rendering amber with `pulse 1.1s ease-in-out infinite` (opacity to 0.35), error red (red wash halo).
- The graph-status variant is borderless-transparent with amber text and its own 0.4rem lamp at 0.15rem halo.

### Script Editor
- **Style:** borderless Field Charcoal well, Ivory 0.78rem text at 1.7 line-height, `tab-size: 2`, 1rem 1.1rem padding, vertical resize between clamp(14rem, 20vw, 18rem) and 26rem.
- **Focus:** no outline — an inset 1px amber box-shadow. Selection uses the amber wash.

### Diagnostics
- A `details` panel whose summary is a lamp-carrying uppercase row (0.7rem / 600 / 0.12em); the log is a slate pre-wrap block (0.7rem / 1.55) with colored lines — info ash, warn #e9c46a, error #ff9a9a. The clear button is a quiet text control (0.68rem) whose hairline strengthens on hover.

### Topbar
- Brand row: a 1.7rem "VS" mark — 145deg graphite gradient square with amber-dim border and 0.35rem radius, amber glyph — beside the product name (0.82rem / 600). The BROWSER BUILD tag is a 999px capsule, 0.64rem / 0.14em, slate, 7.5% hairline.

## Do's and Don'ts

### Do:
- **Do** use Signal Amber (#eaa33c) for the active route and only the active route: selected bus node, bus links, lit lamps, focus rings, carets, selection, and the Run button.
- **Do** keep every equipment module graphite: Panel #131418, Raised #17181d, Highlight #1d1f25, with 1px hairlines (7.5% white resting, 14% white interactive).
- **Do** give every status indicator the lamp treatment: 0.4–0.46rem circle with a 0.18rem halo, switching idle gray (#555b64) → amber → red.
- **Do** engrave labels: uppercase, 600 weight, 0.1em+ letter-spacing, never above 0.72rem.
- **Do** set focus visibly everywhere with the 2px amber outline at 2px offset (the Run button at 3px, the script editor as an inset 1px amber shadow).
- **Do** write real code verbatim in monospace — bus node captions and the `.vpy` record — and keep `tab-size: 2` in the editor.
- **Do** honor `prefers-reduced-motion`: the pulse and all 130ms transitions switch off.
- **Do** announce state changes with `aria-live` and keep DOM order equal to visual order.

### Don't:
- **Don't** introduce a second accent hue. Red (#f07c72) exists only for failed runs; idle, ready, and active states are gray and amber.
- **Don't** paint large amber fields — the Run button is the only amber fill, and its label is Amber Ink (#201505).
- **Don't** use shadows for elevation beyond the dark ambient panel drop and the monitor's inset vignette; amber depth is a 1px ring and lamp halos only.
- **Don't** add display or proportional fonts — the mono stack is the entire type system.
- **Don't** invent signal-bus stages. The bus is exactly Source → Invert → Program Output, each a real supported VapourSynth operation rendered as its actual code.
- **Don't** change the corner language: 0.3rem controls, 0.4rem bus nodes, 0.5rem panels, 999px status pills.
- **Don't** smooth the frame canvas — `image-rendering: pixelated` is the honest rendering of RGBA8 worker output.
