export const CAPTION_FONTS = [
  "Anton",
  "Bebas Neue",
  "Montserrat",
  "Plus Jakarta Sans",
  "Oswald",
  "Bangers",
] as const
export type CaptionFont = (typeof CAPTION_FONTS)[number]

export const CAPTION_EFFECTS = ["outline", "shadow", "box", "none"] as const
export type CaptionEffect = (typeof CAPTION_EFFECTS)[number]

export const CAPTION_POSITIONS = ["bottom", "center", "top"] as const
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number]

export const CAPTION_PRESETS = [
  "hook",
  "beast",
  "boxed",
  "neon",
  "cinema",
  "custom",
] as const
export type CaptionPreset = (typeof CAPTION_PRESETS)[number]
export type NamedCaptionPreset = Exclude<CaptionPreset, "custom">

export const NAMED_CAPTION_PRESETS: readonly NamedCaptionPreset[] = [
  "hook",
  "beast",
  "boxed",
  "neon",
  "cinema",
] as const

export const CAPTION_FONT_SIZE_MIN = 44
export const CAPTION_FONT_SIZE_MAX = 120
export const DEFAULT_CAPTION_FONT_SIZE = 80
export const CAPTION_POSITION_Y_MIN = 0.05
export const CAPTION_POSITION_Y_MAX = 0.95

export type CaptionStyle = {
  preset: CaptionPreset
  fontFamily: CaptionFont
  fontSize: number
  primaryColor: string
  highlightColor: string
  outlineColor: string
  effect: CaptionEffect
  uppercase: boolean
  position: CaptionPosition
  italic: boolean
  positionY?: number | null
}

export const CAPTION_PRESET_STYLES: Record<NamedCaptionPreset, CaptionStyle> = {
  hook: {
    preset: "hook",
    fontFamily: "Anton",
    fontSize: 80,
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    outlineColor: "#000000",
    effect: "outline",
    uppercase: true,
    position: "bottom",
    italic: false,
  },
  beast: {
    preset: "beast",
    fontFamily: "Montserrat",
    fontSize: 84,
    primaryColor: "#FFFFFF",
    highlightColor: "#22C55E",
    outlineColor: "#000000",
    effect: "outline",
    uppercase: true,
    position: "bottom",
    italic: false,
  },
  boxed: {
    preset: "boxed",
    fontFamily: "Plus Jakarta Sans",
    fontSize: 68,
    primaryColor: "#FFFFFF",
    highlightColor: "#FACC15",
    outlineColor: "#000000",
    effect: "box",
    uppercase: false,
    position: "bottom",
    italic: false,
  },
  neon: {
    preset: "neon",
    fontFamily: "Bebas Neue",
    fontSize: 92,
    primaryColor: "#FFFFFF",
    highlightColor: "#5CE1C4",
    outlineColor: "#09090B",
    effect: "shadow",
    uppercase: true,
    position: "bottom",
    italic: false,
  },
  cinema: {
    preset: "cinema",
    fontFamily: "Oswald",
    fontSize: 68,
    primaryColor: "#FEF08A",
    highlightColor: "#FFFFFF",
    outlineColor: "#000000",
    effect: "shadow",
    uppercase: false,
    position: "bottom",
    italic: false,
  },
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = CAPTION_PRESET_STYLES.hook

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function isCaptionFont(value: unknown): value is CaptionFont {
  return typeof value === "string" && (CAPTION_FONTS as readonly string[]).includes(value)
}

export function isCaptionEffect(value: unknown): value is CaptionEffect {
  return typeof value === "string" && (CAPTION_EFFECTS as readonly string[]).includes(value)
}

export function isCaptionPosition(value: unknown): value is CaptionPosition {
  return typeof value === "string" && (CAPTION_POSITIONS as readonly string[]).includes(value)
}

export function isNamedCaptionPreset(value: unknown): value is NamedCaptionPreset {
  return typeof value === "string" && (NAMED_CAPTION_PRESETS as readonly string[]).includes(value)
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toUpperCase() : fallback
}

function clampFontSize(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(CAPTION_FONT_SIZE_MIN, Math.min(CAPTION_FONT_SIZE_MAX, Math.round(value)))
}

function clampPositionY(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const clamped = Math.max(CAPTION_POSITION_Y_MIN, Math.min(CAPTION_POSITION_Y_MAX, value))
  return Math.round(clamped * 10000) / 10000
}

export function resolveCaptionY(style: CaptionStyle, twoSpeakers = false): number {
  if (style.positionY != null && Number.isFinite(style.positionY)) {
    return Math.max(CAPTION_POSITION_Y_MIN, Math.min(CAPTION_POSITION_Y_MAX, style.positionY))
  }
  if (style.position === "center" || (twoSpeakers && style.preset !== "custom" && style.position === "bottom")) {
    return 0.50
  }
  if (style.position === "top") {
    return 0.14
  }
  return 0.80
}

export function detectCaptionPreset(fields: Omit<CaptionStyle, "preset">): CaptionPreset {
  if (fields.positionY != null) return "custom"
  for (const name of NAMED_CAPTION_PRESETS) {
    const candidate = CAPTION_PRESET_STYLES[name]
    if (
      candidate.fontFamily === fields.fontFamily &&
      candidate.fontSize === fields.fontSize &&
      candidate.primaryColor === fields.primaryColor &&
      candidate.highlightColor === fields.highlightColor &&
      candidate.outlineColor === fields.outlineColor &&
      candidate.effect === fields.effect &&
      candidate.uppercase === fields.uppercase &&
      candidate.position === fields.position &&
      candidate.italic === fields.italic
    ) {
      return name
    }
  }
  return "custom"
}

export function normalizeCaptionStyle(raw: unknown): CaptionStyle {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_CAPTION_STYLE }
  }
  const input = raw as Record<string, unknown>
  const base = isNamedCaptionPreset(input.preset) ? CAPTION_PRESET_STYLES[input.preset] : DEFAULT_CAPTION_STYLE
  const positionY = clampPositionY(input.positionY)

  const fields: Omit<CaptionStyle, "preset"> = {
    fontFamily: isCaptionFont(input.fontFamily) ? input.fontFamily : base.fontFamily,
    fontSize: clampFontSize(input.fontSize, base.fontSize),
    primaryColor: normalizeHexColor(input.primaryColor, base.primaryColor),
    highlightColor: normalizeHexColor(input.highlightColor, base.highlightColor),
    outlineColor: normalizeHexColor(input.outlineColor, base.outlineColor),
    effect: isCaptionEffect(input.effect) ? input.effect : base.effect,
    uppercase: typeof input.uppercase === "boolean" ? input.uppercase : base.uppercase,
    position: isCaptionPosition(input.position) ? input.position : base.position,
    italic: typeof input.italic === "boolean" ? input.italic : base.italic,
    ...(positionY !== undefined ? { positionY } : {}),
  }

  return {
    preset: detectCaptionPreset(fields),
    ...fields,
  }
}

export function updateCaptionStyle(current: CaptionStyle, patch: Partial<CaptionStyle>): CaptionStyle {
  const base = isNamedCaptionPreset(patch.preset) ? CAPTION_PRESET_STYLES[patch.preset] : current
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (key === "preset") continue
    if (key === "positionY" && (value === undefined || value === null)) {
      delete merged.positionY
      continue
    }
    if (value !== undefined) merged[key] = value
  }
  return normalizeCaptionStyle(merged)
}

export function isDefaultCaptionStyle(style: CaptionStyle): boolean {
  return detectCaptionPreset(style) === DEFAULT_CAPTION_STYLE.preset
}
