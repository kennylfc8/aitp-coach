# Handoff: AI Tennis Coach — Web Terminal (Desktop)

## Overview
Main screen of an AI Tennis Coach web app, styled as a "Terminal Pro" — a Bloomberg-style
analytics terminal for tennis. A talking 3D coach avatar (currently a stylized glowing orb
placeholder) sits center stage, a dense player-data panel runs down the right, and a command
line for chatting with the coach is pinned to the bottom. Dark, fullscreen (~1440×900), no scroll.

This is the **desktop** companion to the already-handed-off mobile version
(`ACE Coach Mobile.dc.html`, 390×844). Same design system, different layout.

## About the Design Files
The file in this bundle (`ACE Coach Terminal.dc.html`) is a **design reference created in HTML** —
a prototype showing intended look and behavior, **not** production code to copy directly. It is
written as a "Design Component" (a custom streaming-template format), so do **not** lift its markup
verbatim. The task is to **recreate this design in the target codebase's existing environment**
(React, Vue, SwiftUI, native web, etc.) using its established patterns, component library, and
state tools. If no environment exists yet, pick the most appropriate framework and implement there.

All exact measurements, colors, copy, and behavior are documented below so this README is
self-sufficient — a developer who wasn't in the original conversation can build from it alone.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, and interactions are all specified.
Recreate the UI pixel-perfectly using the codebase's libraries and patterns. The glowing "head"
is an intentional placeholder for a future talking 3D avatar — keep it as a glowing orb until the
real avatar/lipsync renderer is wired in.

---

## Global Style / Frame

- **Canvas size:** fixed 1440 × 900 px, `overflow: hidden` (no scroll). Centered on a pure black
  (`#000`) page background.
- **Surface background:** `#03120a` (near-black with a green undertone).
- **Grid texture:** two repeating 1px line gradients (`rgba(78,240,138,.045)`) at `34px × 34px`.
- **Inner glow/vignette:** `box-shadow: inset 0 0 200px rgba(0,0,0,.7), inset 0 0 60px rgba(78,240,138,.05);`
- **Subtle flicker:** very faint CRT flicker keyframe (`flick`, 7s) on the whole surface — opacity
  dips to ~.86 for one frame near the end of the cycle. Optional; cosmetic only.
- **Font:** `'IBM Plex Mono'` (Google Fonts), weights 300–700, monospace throughout.
- **Text selection:** `::selection { background:#c8ff00; color:#03120a; }`
- **Layout:** root is `display:flex; flex-direction:column; padding:16px; gap:12px`.
  Three stacked regions: Topbar (fixed height) → Middle (flex:1) → Command line (fixed height).

### Layout regions
```
┌──────────────────────────────────────── 1440 wide ───────────────────────────────┐
│ TOPBAR  (height 46px)                                                             │
├──────────────────────────────────┬────────────────────────────────────────────── │
│ COACH VIEWPORT (flex:1)           │ RIGHT PANEL (fixed 442px)                      │
│  status line                      │  PLAYER.RATING   (auto height)                 │ Middle
│  orb stage (flex:1)               │  TODAY.SESSION   (flex:1, grows)               │ flex:1
│  transcript + waveform            │  WEAK.ZONES      (auto)                         │
│                                   │  SKILL.MATRIX    (auto)                         │
├──────────────────────────────────┴────────────────────────────────────────────── │
│ COMMAND LINE (height 58px)                                                        │
└────────────────────────────────────────────────────────────────────────────────── ┘
```
Middle is `display:flex; gap:12px`. Right panel is `flex:0 0 442px; display:flex; flex-direction:column; gap:12px`.

---

## Design Tokens

### Colors
- `#03120a` — surface background (near-black green)
- `#000` — page background outside the canvas
- `#4ef08a` — primary phosphor green (data, body values)
- `#c8ff00` — lime, the brand accent (key numbers, active elements, SEND button, cursor)
- `#eafff1` — near-white (emphasis text, headings, target values)
- `#cfeede` — soft green-white (transcript / skill labels body)
- `#9fd9b8` — muted green (inactive session names)
- `#3f8a5e` — dim green (secondary labels, units)
- `#2f8f5a` — dimmer green (inactive session numbers)
- `#235f3e` / `#1f5a39` / `#173f29` — progressively darker greens (faint labels, empty meter blocks, reticle)
- `#2f6b45` — placeholder text color in command line
- **Reds (weak zones / REC):** `#ff4d4d` (REC dot), `#ff6b6b` / `#ff7a7a` (weak text/tags), borders
  `rgba(255,90,90,.45)`, fills `rgba(255,90,90,.08)`, heading `#a85454`.
- Common translucent greens: borders `rgba(78,240,138,.18–.2)`, fills `rgba(78,240,138,.025–.04)`,
  lime borders `rgba(200,255,0,.28–.55)`.

### Typography scale (IBM Plex Mono)
- Logo `ACE//COACH`: 15px / 700 / letter-spacing 1.5px
- Module headers (`> PLAYER.RATING` etc.): 11px / letter-spacing 1px / color `#3f8a5e`
- Status & meta lines: 11–11.5px
- Body / session rows: 12–13px
- Big UTR number: 40px / 700 (rating panel); 15px in topbar
- Target UTR (7.50): 26px / 600
- Transcript: 13px / line-height 1.5
- Command input text: 15px

### Spacing / radius / effects
- Region gap: 12px; root padding: 16px; module padding: 13–14px
- Border radius: **2px** everywhere (sharp terminal look)
- Module border: `1px solid rgba(78,240,138,.2)`; background `rgba(78,240,138,.025)`
- Glow on key numbers: `text-shadow: 0 0 9–16px rgba(200,255,0,.45–.6)`
- Lime button glow: `box-shadow: 0 0 22px rgba(200,255,0,.35)` → hover `0 0 30px rgba(200,255,0,.55)`

### Corner brackets (signature motif)
Each framed block has L-shaped corner accents (absolutely-positioned divs with two borders).
- **Coach viewport:** all 4 corners, `18×18px`, `2px solid #c8ff00` (lime).
- **Command line:** top-left + bottom-right, `14×14px`, `2px solid #c8ff00`.
- **Right-panel modules:** top-left + bottom-right, `11×11px`, `1px solid #4ef08a` (green) — except
  WEAK.ZONES which uses `rgba(255,90,90,.5)` (red).

---

## Screens / Views

There is one screen. Components, top to bottom:

### 1. Topbar  (height 46px, bordered, `rgba(78,240,138,.03)` fill)
- **Left cluster:**
  - `▌` lime glyph (`#c8ff00`, glowing) + wordmark `ACE//COACH` (the `//` in `#4ef08a`, rest `#eafff1`).
  - **Tabs** (gap 8px): `[ COACH ]` (active by default) and `[ TECHNIQUE.3D ]`.
    - Active tab (COACH): lime text `#c8ff00`, border `rgba(200,255,0,.55)`, bg `rgba(200,255,0,.1)`,
      weight 700, glow `0 0 16px rgba(200,255,0,.18)`.
    - Inactive tab: text `#3f8a5e`, border `rgba(78,240,138,.2)`, transparent bg.
    - TECHNIQUE.3D active variant uses green `#4ef08a` accents instead of lime.
    - Hover: border brightens, text → `#eafff1`.
- **Right cluster** (font 12px, items separated by dim `·`):
  - `UTR` (dim) · `6.70` (lime, 15px, 700, glowing) · `▲0.30` (green).
  - `STREAK` (dim) · `14d` (`#eafff1`).
  - Blinking red dot (`#ff4d4d`, `recpulse` animation) · `LIVE` (`#ff7a7a`).

### 2. Coach Viewport  (left, flex:1; lime border + 4 lime corners)
- **Status line** (top, bordered bottom): `> render: live · lipsync: on · fps 60`
  (keywords colored: live=`#4ef08a`, on=`#c8ff00`, 60=`#eafff1`; rest `#3f8a5e`).
  Right side: `COACH.AGENT — v2.4 █` in `#235f3e`.
- **Orb stage** (flex:1, centered, `overflow:hidden`):
  - Ground glow ellipse below the orb (`radial-gradient` green, blurred).
  - Dashed rotating ring `360px` (`ringspin` 26s linear) + static faint ring `418px`.
  - **Orb:** `288×288px` circle, `overflow:hidden`. Radial gradient core
    `radial-gradient(circle at 50% 42%, rgba(200,255,0,.32), rgba(78,240,138,.16) 38%, rgba(8,40,24,.5) 66%, rgba(3,18,10,.2) 100%)`.
    Box-shadow `0 0 70px rgba(78,240,138,.4), 0 0 130px rgba(200,255,0,.14), inset 0 0 60px rgba(200,255,0,.18)`.
    Animation `orbpulse` 4.5s (scale 1→1.035).
    Inside: an 18px grid overlay (mix-blend overlay), a bright white-lime core blob (96px, blurred),
    two dim "eye" bars (`rgba(3,18,10,.55)`), and a horizontal **scanline** (3px lime gradient,
    glowing) animating top→bottom via `scan` 3.2s linear infinite.
  - Reticle marks: `+` top-left, `+` top-right, `TRACKING▌` bottom-left (all `#235f3e`).
- **Transcript + waveform** (bottom, bordered top, `rgba(3,18,10,.55)` fill):
  - `> coach:` (lime, 600) + coach reply text (`#cfeede`, 13px) + a blinking block cursor
    (`8×14px` lime, `blink` 1s step-end).
  - Default reply: *"Good rally. On the backhand you're arming the ball — rotate from the hips
    earlier, split-step, and drive through contact. Let's run 20 cross-court."*
  - Below: `AUDIO ▌` label + **waveform** (row of ~52 thin bars, 3px wide, green with every 8th lime,
    each animating height via `wv` keyframe with staggered delay) + timecode `00:14 / 00:22` (right).

### 3. Right Panel — PLAYER.RATING module
- Header `> PLAYER.RATING`.
- Big line: `UTR` (dim) · `6.70` (40px lime, glowing) · `──▸` (dim green arrow) · `7.50` (26px `#eafff1`).
- 3-column grid (gap 10px):
  - **CONFIDENCE** — ASCII meter `████████████░░` (filled lime `#c8ff00`, empty `#1f5a39`) over 16 blocks
    at 80%, then `80%` in `#eafff1`.
  - **DEADLINE** — `12` (`#eafff1`,14px) `weeks` (dim).
  - **FOCUS** — `backhand` (`#ff6b6b`).

### 4. Right Panel — TODAY.SESSION module  (flex:1, grows to fill)
- Header `> TODAY.SESSION` + a `70m` chip (lime text, lime border).
- 5 rows, each `display:flex` (number / name / duration):
  | # | Name | Dur |
  |---|------|-----|
  | 01 | WARMUP | 10m |
  | 02 | BACKHAND CROSS | 20m |
  | 03 | 20-BALL RALLY | 15m |
  | 04 | VOLLEY REACT | 15m |
  | 05 | LIVE POINTS | 15m |
  - **Row 01 (active):** bg `rgba(200,255,0,.08)`, 2px lime left border, number lime, name `#eafff1`.
  - Other rows: transparent bg, 2px faint-green left border, number `#2f8f5a`, name `#9fd9b8`, dur `#3f8a5e`.
  - **Hover (any row):** bg `rgba(200,255,0,.07)`.

### 5. Right Panel — WEAK.ZONES module  (red-tinted)
- Border/corners red, fill `rgba(255,90,90,.03)`, header `> WEAK.ZONES` in `#a85454`.
- Two tag chips: `! BACKHAND`, `! CONSISTENCY` — text `#ff7a7a`, border `rgba(255,90,90,.45)`,
  bg `rgba(255,90,90,.08)`, radius 2px, padding `4px 10px`.

### 6. Right Panel — SKILL.MATRIX module
- Header `> SKILL.MATRIX`.
- 4 rows (label 86px / ASCII meter flex / value), 16-block meters:
  | Skill | Value | Meter |
  |-------|-------|-------|
  | FOREHAND | 8.0 | ~13/16 filled |
  | BACKHAND | 4.5 | ~7/16 filled |
  | SERVE | 5.5 | ~9/16 filled |
  | MOVEMENT | 7.0 | ~11/16 filled |
  - Meter fill = `round(value/10 × 16)` `█`, rest `░`. Empty blocks `#173f29`.
  - Color rule: value `< 5` → red `#ff6b6b` (filled + value); else lime `#c8ff00`. So BACKHAND renders red.

### 7. Command Line  (height 58px, lime border, 2 lime corners; whole bar is click-to-focus)
- `>` prompt (lime, 18px, 700, glowing).
- Input display: shows typed text (`#eafff1`) or placeholder `ask the coach` (`#2f6b45`) when empty,
  followed by a blinking lime block cursor (`9×18px`, `blink`). The real `<input>` is visually hidden
  (offscreen) and captures keystrokes; clicking the bar focuses it.
- `● REC` button: red dot (`#ff4d4d`, glowing) + `REC`. Idle: text `#ff7a7a`, bg `rgba(255,77,77,.06)`,
  red border. **Active (recording):** text `#ffd5d5`, bg `rgba(255,77,77,.18)`, `recpulse` animation.
  Hover: border `#ff8a8a`, text `#ffd5d5`.
- `SEND ▸` button: solid lime `#c8ff00` bg, `#03120a` text, 700, glowing. Hover: bg `#d8ff44`, stronger glow.

---

## Interactions & Behavior

- **Tab switching:** clicking `COACH` / `TECHNIQUE.3D` sets active tab and swaps the accent styling
  (lime for COACH, green for TECHNIQUE.3D). In this prototype the viewport content does not change
  between tabs — TECHNIQUE.3D is a placeholder destination for a future 3D technique view.
- **Command input:** typing updates the displayed text live. Pressing **Enter** or clicking **SEND**
  submits.
- **On submit (non-empty):** clear the input and replace the coach transcript with an acknowledgement:
  `Copy that — "<query>". Analyzing your last 200 backhands… queueing a drill set now. Watch the contact point.`
  Then re-focus the input. Empty submits are ignored.
- **REC toggle:** flips a `recording` boolean. When on, the button pulses (`recpulse`) and the waveform
  amplitude increases ~25% with higher opacity. (No real audio capture in the prototype — wire to the
  mic/STT layer in production.)
- **Click anywhere on the command bar** focuses the hidden input.
- **Auto-focus** the command input on mount.
- **Hover states:** tabs, session rows, REC, SEND (described above).
- **Ambient animations (all CSS keyframes, infinite):** `blink` (cursors, 1s step-end),
  `scan` (orb scanline top→bottom, 3.2s), `wv` (waveform bars, ~0.6–1.3s staggered),
  `orbpulse` (orb breathe, 4.5s), `ringspin` (dashed ring, 26s), `recpulse` (live dot + active REC),
  `flick` (surface CRT flicker, 7s).

## State Management
Minimal local component state:
- `command: string` — current command-line text (controlled input).
- `recording: boolean` — REC toggle; drives REC button style and waveform amplitude.
- `tab: 'COACH' | 'TECH'` — active topbar tab.
- `transcript: string` — current coach reply text.

Derived (compute in render): `hasCommand` / `showPlaceholder` from `command.length`; ASCII meters
via `round(pct/100 × total)` filled `█` + remainder `░`; skill color from `value < 5`.

In production, `transcript`, `recording`, the session list, ratings, and skill matrix would come from
the coaching backend / AI agent rather than being hardcoded.

## Assets
None external. The avatar is a **placeholder glowing orb** built purely from CSS gradients/shadows —
replace with the real talking 3D avatar + lipsync renderer when available. The only external dependency
is the **IBM Plex Mono** web font (Google Fonts). All icons are Unicode glyphs (`▌ ▸ █ ░ ● ▲ + ▮`).

## Files
- `ACE Coach Terminal.dc.html` — the desktop (1440×900) design reference (this bundle).
- `ACE Coach Mobile.dc.html` — the mobile (390×844) version, handed off separately; same design system.
