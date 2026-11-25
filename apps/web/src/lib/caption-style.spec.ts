import assert from "node:assert/strict"
import {
  CAPTION_FONT_SIZE_MAX,
  CAPTION_FONT_SIZE_MIN,
  CAPTION_PRESET_STYLES,
  DEFAULT_CAPTION_STYLE,
  detectCaptionPreset,
  isDefaultCaptionStyle,
  normalizeCaptionStyle,
  updateCaptionStyle,
} from "./caption-style.ts"

// 1. Defaults and invalid inputs
assert.deepEqual(normalizeCaptionStyle(null), DEFAULT_CAPTION_STYLE)
assert.deepEqual(normalizeCaptionStyle(undefined), DEFAULT_CAPTION_STYLE)
assert.deepEqual(normalizeCaptionStyle("invalid"), DEFAULT_CAPTION_STYLE)
assert.deepEqual(normalizeCaptionStyle({}), DEFAULT_CAPTION_STYLE)

// 2. Named preset resolution
assert.deepEqual(normalizeCaptionStyle({ preset: "neon" }), CAPTION_PRESET_STYLES.neon)
assert.deepEqual(normalizeCaptionStyle({ preset: "cinema" }), CAPTION_PRESET_STYLES.cinema)

// 3. Clamping fontSize and normalizing hex colors
const normalized = normalizeCaptionStyle({
  preset: "hook",
  fontFamily: "Bangers",
  fontSize: 999.4,
  primaryColor: " #aabbcc ",
  highlightColor: "#112233",
  outlineColor: "not-a-color",
  effect: "box",
  uppercase: false,
  position: "top",
  italic: true,
})
assert.equal(normalized.preset, "custom")
assert.equal(normalized.fontFamily, "Bangers")
assert.equal(normalized.fontSize, CAPTION_FONT_SIZE_MAX)
assert.equal(normalized.primaryColor, "#AABBCC")
assert.equal(normalized.highlightColor, "#112233")
assert.equal(normalized.outlineColor, "#000000")
assert.equal(normalized.effect, "box")
assert.equal(normalized.uppercase, false)
assert.equal(normalized.position, "top")
assert.equal(normalized.italic, true)

// Low clamp + rounding
const lowClamped = normalizeCaptionStyle({ fontSize: 10 })
assert.equal(lowClamped.fontSize, CAPTION_FONT_SIZE_MIN)
const rounded = normalizeCaptionStyle({ fontSize: 73.6 })
assert.equal(rounded.fontSize, 74)

// 4. Preset auto-detection even if caller passes preset: "custom"
const detected = normalizeCaptionStyle({
  ...CAPTION_PRESET_STYLES.beast,
  preset: "custom",
  highlightColor: "#22c55e",
})
assert.equal(detected.preset, "beast")
assert.equal(detected.highlightColor, "#22C55E")
assert.equal(detectCaptionPreset(detected), "beast")

// 5. updateCaptionStyle switching presets & drifting to custom and back
const switched = updateCaptionStyle(DEFAULT_CAPTION_STYLE, { preset: "boxed" })
assert.deepEqual(switched, CAPTION_PRESET_STYLES.boxed)

const customized = updateCaptionStyle(switched, { fontSize: 90 })
assert.equal(customized.preset, "custom")
assert.equal(customized.fontSize, 90)
assert.equal(customized.fontFamily, "Plus Jakarta Sans")

const reverted = updateCaptionStyle(customized, { fontSize: 68 })
assert.equal(reverted.preset, "boxed")
assert.equal(isDefaultCaptionStyle(DEFAULT_CAPTION_STYLE), true)
assert.equal(isDefaultCaptionStyle(reverted), false)

console.log("caption-style self-check passed")
