# DartClip Marketing Landing Page — Design Direction (`DESIGN.md`)

## Design Read
Reading this as: marketing landing page for Indonesian and global video creators and streamers evaluating DartClip (free desktop + self-hostable video clipper), in a dark broadcast-studio editorial style with working light mode, dial **ENERGY 2 / RHYTHM 3 / MOTION 2**.

## Dials
- **Dial**: `ENERGY 2 / RHYTHM 3 / MOTION 2`
- **ENERGY 2 (Balanced-Confident)**: Crisp studio presence. Strong focal headline and interactive vertical monitor above the fold, without carnival noise or neon spam.
- **RHYTHM 3 (Varied Compositions)**: Every section has a distinct visual shape matching its content:
  1. Asymmetric 12-col Hero (editorial copy left, interactive 16:9->9:16 monitor right)
  2. Full-width Interactive Clip Studio console (live reframe, 5 caption presets, editable Hook Thumbnail intro, 9:16 Safe Zone overlay)
  3. Sticky-intro + 4-band vertical pipeline walkthrough (real 4 stages of DartClip, NOT a 3-step icon row)
  4. Split narrative + 2-column architectural comparison matrix (local Rust render vs cloud subscription workflow)
  5. Asymmetric 2-part Free Download (7 cols) + Voluntary Donate card (5 cols) — NOT 3 pricing tiers
  6. Narrow single-column numbered FAQ accordion (`01`–`06`)
  7. Closing action band + compact 2-group footer (NOT a 4-column template footer)
- **MOTION 2 (Purposeful Transitions & Controls)**: Smooth state transitions on monitor crop/reframe switching, timeline playhead preview (pausable, respects `prefers-reduced-motion: reduce`), subtle scroll-reveal only when reduced-motion is off. Zero endless ambient pulse/bounce/float loops.

## Identity Motif & Visual Levers
- **One focal point per screen**: Above the fold, the interactive 9:16 live monitor paired with the crisp headline is the sole focal point.
- **Identity motif**: Broadcast crop reticle corner marks (`9:16` frame brackets) and subtle timecode telemetry (`00:14:22 -> 00:15:08`) echoing DartClip's dartboard-bullseye mark. Used ONLY on monitor stages, never as full-page grid wallpaper.
- **Pure Monochrome Stealth**: Graphite on paper and brushed platinum on obsidian distinguish actions without introducing a category hue.
- **Borderless tonal surface hierarchy**: Structure is carried by stepped tonal surfaces (`--bg` -> `--surface` -> `--surface-2` -> `--stage`), subtle shadow/top-edge elevation, and whitespace rather than nested box-in-box border outlines. Borders are reserved strictly for functional boundaries (sticky header hairline, text inputs, active focus rings, table/FAQ row dividers, and live video crop/safe-zone reticles).
- **Authentic Hook Thumbnail accent**: `#FACC15` yellow bar appears ONLY inside the live Hook Thumbnail Intro preview card because DartClip's real `hook_thumbnail.rs` renderer uses `#FACC15`.

## Color system: Pure Monochrome Stealth

| Role | Light: architectural paper | Dark: stealth obsidian |
|---|---|---|
| Canvas / elevated / secondary | `#F7F7F8` / `#FFFFFF` / `#EFEFF1` | `#09090B` / `#111114` / `#18181C` |
| Stage / bar / subbar | `#ECECEF` / `#F5F5F7` / `#EFEFF2` | `#0E0E11` / `#141418` / `#111115` |
| Stage control / track / hover | `#FFFFFF` / `#E4E4E7` / `#F4F4F6` | `#1B1B20` / `#24242A` / `#232329` |
| Primary / subtle / muted ink | `#09090B` / `#27272A` / `#52525B` | `#FAFAFA` / `#D4D4D8` / `#A1A1AA` |
| Accent / hover / CTA ink | `#18181B` / `#09090B` / `#FAFAFA` | `#E4E4E7` / `#FAFAFA` / `#09090B` |
| Gaming / sport / comedy dots | `#18181B` / `#52525B` / `#71717A` | `#E4E4E7` / `#A1A1AA` / `#71717A` |

All three categories use platinum dots on dark video badges. Video content and renderer-specific caption colors are independent of the UI theme.

### Verified text contrast

Ratios use WCAG sRGB relative luminance. Each listed pair exceeds the 4.5:1 AA threshold for normal text; decorative surfaces are not text pairs.

| Foreground on background | Light | Dark |
|---|---:|---:|
| Primary ink on canvas | 18.58:1 | 19.06:1 |
| Subtle ink on secondary surface | 12.97:1 | 11.98:1 |
| Muted ink on canvas | 7.22:1 | 7.76:1 |
| Muted ink on studio stage | 6.56:1 | 7.52:1 |
| Accent on studio stage | 15.03:1 | 15.19:1 |
| CTA ink on solid fill | 16.97:1 | 15.68:1 |
| CTA ink on hover fill | 19.06:1 | 19.06:1 |

## Typography (Intentional non-AI-default selection per R-06 & R-31)
- **Display / Headings**: `"Bricolage Grotesque"` (weights 500, 600, 700; tight `-0.03em` tracking) — geometric-humanist display face with subtle ink-trap sharpness that feels engineered like a creative tool, avoiding default Inter/Geist/Space Grotesk.
- **Editorial Italic Emphasis**: `"Instrument Serif"` italic (weight 400) used sparingly on 1 key phrase in H1 and closing statement for human warmth against precision hardware framing.
- **Body / UI**: `"Plus Jakarta Sans"` (weights 400, 500, 600, 700) — high-legibility geometric sans with clean Indonesian diacritics/cadence and comfortable long-form scanning.
- **Timecode / Spec Telemetry**: `"IBM Plex Mono"` (weights 400, 500) — used strictly for authentic video timecodes (`00:14:22`), aspect ratios (`9:16`), and audio loudness specs (`-14 LUFS`), never for large headings.
- **Authentic Render Fonts (Inside Clip Studio Preview ONLY)**: Local `.ttf` fonts copied verbatim from `apps/web/public/fonts/` (`Anton`, `Bebas Neue`, `Montserrat`, `Plus Jakarta Sans`, `Oswald`, `Bangers`) so the live caption preview matches actual FFmpeg output.

## Radius, Elevation & Effect Discipline
- Border radius system (R-11): `6px` for inputs/chips/small buttons, `10px` for primary CTAs and feature blocks, `16px` for studio monitor frames and dialogs. Never pill-everything.
- Shadows (R-12): Flat surfaces by default; subtle elevation shadow ONLY on floating dialogs and the recessed 9:16 monitor frame.
- Glassmorphism (R-10): Backdrop blur ONLY on the sticky 56px header bar (1 element total).
- Glow (R-13): At most 1 subtle radial silver sheen behind the interactive Hero Monitor (zero glow on buttons, cards, badges, or icons).
- Icons (R-04): Custom minimal geometric SVG marks designed specifically for video framing, timecode, platforms, and OS targets (no generic AI sparkle/star/robot/magic icons, no full Lucide wallpaper).

## Copy & Honesty Rules (Hard Gates)
- Primary language: Natural, conversational Indonesian for video creators, with complete English toggle (`ID` / `EN`).
- **ZERO em dashes (`—`)** anywhere in UI text (R-02). Use periods, commas, colons, or parentheses.
- **ZERO fake numbers, testimonials, logos, or countdown timers** (R-17, R-18, R-36, R-38).
- **ZERO AI buzzwords** (R-16: no "AI Powered", "Revolutionary", "Seamless", "Next Generation", "Effortless", "Game-changer", "Canggih", "Revolusioner").
- **Real behavior on every button** (R-26): Download and Donate buttons read from `src/data/site-config.ts`; until final URLs are pasted, clicking opens an honest, Escape-closable dialog with repo/status info and copyable details.
- **Real accessibility** (R-32, R-39, R-03): Base CSS `cursor: pointer` on all enabled controls, visible `:focus-visible` ring >= 3:1, native `<button>`/`<a>`, >= 44px touch targets on mobile, labeled mobile `"Menu"` button, zero horizontal overflow from 360px to 1440px.
