# Design system — "Observatory"

Personal Universe should feel like stepping into a quiet instrument room at night: deep, calm,
precise, with light used sparingly and always meaning something.

## Principles

1. **Colour is information.** Each world owns exactly one hue. The hue only ever appears as *light* —
   a glow in the atmosphere, a hairline, a small fill — never as a large saturated slab. If you can see
   teal, you are in or looking at Knowledge.
2. **Type does the hierarchy.** Instrument Serif for moments (titles, big numbers, the clock), Geist for
   reading and controls, Geist Mono for labels, times and figures. Three roles, no exceptions.
3. **Surfaces are few and thin.** One plate style (1px hairline, 18px radius, 3% white). Lists inside plates
   are borderless rows. Many sections have no container at all — a mono label and whitespace are enough.
4. **Motion explains.** Worlds cross-fade with a 10px rise; panels rise 14px; the dock item widens to show
   its name. Nothing loops except a 50-second atmospheric drift, which Calm mode turns off.
5. **Practical first.** Body text is 13.5px at ≥ 4.5:1 contrast, every control has a focus ring and an
   accessible name, `prefers-reduced-motion` is honoured, and all three themes share the same tokens.

## Tokens (`src/styles/tokens.css`)

| Group | Tokens |
|---|---|
| Type | `--font-display` Instrument Serif · `--font-ui` Geist · `--font-mono` Geist Mono; sizes 10.5 / 12 / 13.5 / 15 / 19 / 34 / 64 |
| Space | 4px rhythm: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 |
| Shape | radii 7 / 12 / 18 / pill |
| Motion | `--ease` cubic-bezier(.2,.8,.2,1); 140 / 260 / 520 ms |
| Ink | `--ink` → `--ink-4` (four steps), `--line`, `--line-2` |
| Surface | `--plate` / `-2` / `-3`, `--glass` (blurred), `--panel` (opaque dialogs), `--scrim` |
| World hues | home `#E9CB8E` · knowledge `#74D2D4` · academy `#A3A4FF` · finance `#7EDBA6` · projects `#F4A074` · archive `#D3B0EA` · tools `#86B8F4` |
| Semantic | `--good` · `--warn` · `--bad` |

`[data-world]` on the root sets `--hue`; everything that should feel "of this world" reads `--hue`.
Themes — **Midnight** (default), **Graphite** (neutral, low atmosphere) and **Daylight** (paper; hues
deepen so they stay legible as text) — only redefine tokens.

## Signature elements

* **Atmosphere** — a static star field drawn once to canvas, two slow hue-tinted glows, fine grain.
  No per-frame work.
* **Dock** — a floating glass rail of seven custom glyphs; the active world expands to show its name
  and gains a light bar beneath it.
* **Day Arc** (Home) — the waking day as a half-circle: classes are thick coloured arcs, study sessions
  dotted arcs, deadlines diamonds, *now* a glowing point.
* **Map** (Knowledge) — circle packing on canvas; regions are folders, bodies are files sized by weight
  and coloured by type. Click to fly in, click empty space to step back.
* **Icons** — one hand-drawn set on a 24-unit grid, 1.5 stroke, round joins. World glyphs share a motif:
  a body and the path it travels.
* **Charts** — hand-built SVG; one hue per series, hairline grids, hover read-outs, direct labels.
  Projections are always dashed and always captioned with their rule.

## Where 3D was deliberately not used

Spatial interaction earns its place where *position carries meaning*: the file map (containment and mass)
and the knowledge graph (relatedness). Both are 2D with zoom, because a flat plane keeps every label
readable and every target clickable; a 3D camera would add occlusion and navigation cost without adding
information. Timetables, ledgers and task boards stay conventional — they are already the right shape.
