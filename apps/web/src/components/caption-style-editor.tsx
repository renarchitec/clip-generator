import { useState } from "react"
import { RotateCcw, WandSparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  CAPTION_EFFECTS,
  CAPTION_FONT_SIZE_MAX,
  CAPTION_FONT_SIZE_MIN,
  CAPTION_FONTS,
  CAPTION_PRESETS,
  CAPTION_PRESET_STYLES,
  CAPTION_POSITIONS,
  DEFAULT_CAPTION_STYLE,
  updateCaptionStyle,
  type CaptionEffect,
  type CaptionFont,
  type CaptionPosition,
  type CaptionPreset,
  type CaptionStyle,
} from "@/lib/caption-style"
import { useT } from "@/lib/i18n"

const fontSizes = [
  { label: "S", size: 60 },
  { label: "M", size: 72 },
  { label: "L", size: 80 },
  { label: "XL", size: 96 },
]
const swatches = ["#FFFFFF", "#000000", "#FACC15", "#5CE1C4", "#FF5D5D"]

function captionEffect(style: CaptionStyle): React.CSSProperties {
  if (style.effect === "outline") {
    return {
      WebkitTextStroke: "0.4px",
      paintOrder: "stroke fill",
      textShadow: `-2px -2px 0 ${style.outlineColor}, 0 -2px 0 ${style.outlineColor}, 2px -2px 0 ${style.outlineColor}, -2px 0 0 ${style.outlineColor}, 2px 0 0 ${style.outlineColor}, -2px 2px 0 ${style.outlineColor}, 0 2px 0 ${style.outlineColor}, 2px 2px 0 ${style.outlineColor}, 0 4px 9px rgb(0 0 0 / 55%)`,
    }
  }
  if (style.effect === "shadow") {
    return {
      WebkitTextStroke: `0.3px ${style.outlineColor}`,
      textShadow: `0 3px 2px ${style.outlineColor}, 0 8px 18px rgb(0 0 0 / 70%)`,
    }
  }
  return { textShadow: style.effect === "none" ? "0 2px 5px rgb(0 0 0 / 80%)" : "0 2px 6px rgb(0 0 0 / 45%)" }
}

function PreviewText({ value, sample, twoSpeakers }: { value: CaptionStyle; sample: string[]; twoSpeakers: boolean }) {
  const placement = value.position === "top" ? "items-start pt-3" : value.position === "center" ? "items-center" : "items-end pb-3"
  const fontSize = Math.max(10, Math.min(22, value.fontSize / 4))
  const common = captionEffect(value)
  return <div className={`absolute inset-0 flex justify-center px-4 ${placement}`}>
    {twoSpeakers && <div aria-hidden="true" className="absolute left-0 right-0 top-1/2 border-t border-dashed border-white/30" />}
    <p className="relative flex max-w-full flex-wrap justify-center gap-x-1.5 gap-y-0.5 text-center leading-none" style={{ fontFamily: `"${value.fontFamily}", sans-serif`, fontSize, fontStyle: value.italic ? "italic" : "normal", textTransform: value.uppercase ? "uppercase" : "none" }}>
      {sample.map((word, index) => <span key={`${word}-${index}`} style={{ color: index === 1 ? value.highlightColor : value.primaryColor, ...common, ...(value.effect === "box" ? { backgroundColor: `${value.outlineColor}bf`, borderRadius: 5, padding: "3px 5px" } : {}) }}>{word}</span>)}
    </p>
  </div>
}

function ColorControl({ label, color, onChange, id }: { label: string; color: string; onChange: (value: string) => void; id: string }) {
  return <div className="flex items-center justify-between gap-2">
    <label htmlFor={id} className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{label}</label>
    <div className="flex items-center gap-1.5">
      {swatches.map((swatch) => <button key={swatch} type="button" aria-label={`${label} ${swatch}`} aria-pressed={color.toUpperCase() === swatch} onClick={() => onChange(swatch)} className={`size-5 rounded-full border border-black/15 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring ${color.toUpperCase() === swatch ? "ring-2 ring-accent ring-offset-1 ring-offset-background" : ""}`} style={{ backgroundColor: swatch }} />)}
      <input id={id} type="color" value={color} onChange={(event) => onChange(event.target.value.toUpperCase())} className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0" aria-label={`${label} custom color`} />
    </div>
  </div>
}

export function CaptionStyleEditor({ value, onChange, twoSpeakers = false }: { value: CaptionStyle; onChange: (style: CaptionStyle) => void; twoSpeakers?: boolean }) {
  const t = useT()
  const [expanded, setExpanded] = useState(value.preset === "custom")
  const update = (patch: Partial<CaptionStyle>) => {
    setExpanded(true)
    onChange(updateCaptionStyle(value, patch))
  }
  const presetLabel = (preset: Exclude<CaptionPreset, "custom">) => t.captionPresetNames[preset]
  const selectedSize = fontSizes.find((item) => item.size === value.fontSize)?.label ?? ""
  const sample = t.captionPreviewSample.split(" ")
  const words = sample.length >= 3 ? sample.slice(0, 3) : ["MAKE", "MOMENTS", "POP"]

  return <div className="space-y-3">
    <div className="relative aspect-[16/7] min-h-[82px] overflow-hidden rounded-md border border-white/10 bg-[radial-gradient(ellipse_at_50%_100%,#334155_0%,#171d27_48%,#0b0f16_100%)] shadow-inner">
      <div aria-hidden="true" className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "linear-gradient(rgb(255 255 255 / 16%) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 16%) 1px, transparent 1px)", backgroundSize: "18px 18px", maskImage: "radial-gradient(ellipse at center, black, transparent 80%)" }} />
      <Badge variant="secondary" className="absolute right-2 top-2 z-10 h-5 bg-black/35 text-[9px] text-white/80 backdrop-blur">{{ top: t.captionPositionNames.top, center: t.captionPositionNames.center, bottom: t.captionPositionNames.bottom }[value.position]}</Badge>
      <PreviewText value={value} sample={words} twoSpeakers={twoSpeakers} />
      {twoSpeakers && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] uppercase tracking-widest text-white/35">{t.twoSpeakers}</span>}
    </div>

    <div className="grid grid-cols-3 gap-1.5">
      {CAPTION_PRESETS.filter((preset): preset is Exclude<CaptionPreset, "custom"> => preset !== "custom").map((preset) => {
        const style = CAPTION_PRESET_STYLES[preset]
        const active = value.preset === preset
        return <button key={preset} type="button" aria-pressed={active} onClick={() => { onChange(updateCaptionStyle(value, { preset })); setExpanded(false) }} className={`min-w-0 rounded-md border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-accent bg-accent/15" : "border-border/80 bg-background/40 hover:bg-secondary/70"}`}>
          <span className="block truncate text-center text-[17px] leading-5" style={{ fontFamily: `"${style.fontFamily}", sans-serif`, color: style.highlightColor, textShadow: `0 1px 2px ${style.outlineColor}` }}>Aa</span>
          <span className="mt-0.5 block truncate text-center text-[10px] font-medium">{presetLabel(preset)}</span>
        </button>
      })}
    </div>

    <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/40 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2"><WandSparkles className="size-3.5 shrink-0 text-accent" /><span className="text-xs font-medium">{t.captionCustom}</span>{value.preset === "custom" && <Badge variant="secondary" className="h-5 text-[9px]">{t.captionCustomBadge}</Badge>}</div>
      <div className="flex items-center gap-1.5">
        {value.preset !== "hook" && <Button type="button" variant="ghost" size="sm" aria-label={t.captionReset} className="h-7 px-2 text-[10px]" onClick={() => { onChange({ ...DEFAULT_CAPTION_STYLE }); setExpanded(false) }}><RotateCcw className="mr-1 size-3" />{t.captionReset}</Button>}
        <Switch aria-label={t.captionCustom} checked={expanded} onCheckedChange={setExpanded} />
      </div>
    </div>

    {expanded && <div className="space-y-3 border-t border-border/70 pt-3">
      <Field className="gap-1.5"><FieldLabel htmlFor="caption-font" className="text-[11px] text-muted-foreground">{t.captionFont}</FieldLabel><Select value={value.fontFamily} onValueChange={(font) => update({ fontFamily: font as CaptionFont })}><SelectTrigger id="caption-font" className="h-9 w-full rounded-md"><SelectValue /></SelectTrigger><SelectContent>{CAPTION_FONTS.map((font) => <SelectItem key={font} value={font}><span style={{ fontFamily: `"${font}", sans-serif` }}>{font}</span></SelectItem>)}</SelectContent></Select></Field>
      <Field className="gap-1.5"><div className="flex items-center justify-between"><FieldLabel className="text-[11px] text-muted-foreground">{t.captionSize}</FieldLabel><span className="font-mono text-[11px] tabular-nums text-foreground">{value.fontSize}px</span></div><ToggleGroup type="single" aria-label={t.captionSize} value={selectedSize} onValueChange={(label) => { const size = fontSizes.find((item) => item.label === label)?.size; if (size) update({ fontSize: size }) }} className="w-full gap-1 rounded-md bg-secondary/70 p-1">{fontSizes.map(({ label, size }) => <ToggleGroupItem key={label} value={label} className="h-7 flex-1 rounded-sm text-[10px] data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs">{label}<span className="ml-1 text-[9px] text-muted-foreground">{size}</span></ToggleGroupItem>)}</ToggleGroup><input aria-label={`${t.captionSize} ${value.fontSize}px`} type="range" min={CAPTION_FONT_SIZE_MIN} max={CAPTION_FONT_SIZE_MAX} step={1} value={value.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} className="h-5 w-full cursor-pointer accent-accent" /></Field>
      <Field className="gap-1.5"><FieldLabel className="text-[11px] text-muted-foreground">{t.captionEffect}</FieldLabel><ToggleGroup type="single" aria-label={t.captionEffect} value={value.effect} onValueChange={(effect) => { if (effect) update({ effect: effect as CaptionEffect }) }} className="grid w-full grid-cols-4 gap-1">{CAPTION_EFFECTS.map((effect) => <ToggleGroupItem key={effect} value={effect} className="h-7 min-w-0 rounded-sm px-1 text-[10px] data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs">{t.captionEffectNames[effect]}</ToggleGroupItem>)}</ToggleGroup></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field className="gap-1.5"><FieldLabel className="text-[11px] text-muted-foreground">{t.captionFormat}</FieldLabel><div className="flex gap-1"><Button type="button" variant={value.uppercase ? "secondary" : "outline"} aria-pressed={value.uppercase} aria-label={t.captionUppercase} className="h-8 flex-1 px-2 font-mono text-xs" onClick={() => update({ uppercase: !value.uppercase })}>AA</Button><Button type="button" variant={value.italic ? "secondary" : "outline"} aria-pressed={value.italic} aria-label={t.captionItalic} className="h-8 flex-1 px-2 font-serif text-sm italic" onClick={() => update({ italic: !value.italic })}>I</Button></div></Field>
        <Field className="gap-1.5"><FieldLabel className="text-[11px] text-muted-foreground">{t.captionPosition}</FieldLabel><ToggleGroup type="single" aria-label={t.captionPosition} value={value.position} onValueChange={(position) => { if (position) update({ position: position as CaptionPosition }) }} className="grid w-full grid-cols-3 gap-0.5 rounded-md bg-secondary/70 p-0.5">{CAPTION_POSITIONS.map((position) => <ToggleGroupItem key={position} value={position} className="h-7 min-w-0 rounded-sm px-0.5 text-[9px] data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs">{t.captionPositionNames[position]}</ToggleGroupItem>)}</ToggleGroup></Field>
      </div>
      <Field className="gap-2 rounded-md border border-border/70 bg-background/40 p-2"><FieldDescription className="text-[10px]">{t.captionColorsHint}</FieldDescription><ColorControl id="caption-primary" label={t.captionPrimaryColor} color={value.primaryColor} onChange={(primaryColor) => update({ primaryColor })}/><ColorControl id="caption-highlight" label={t.captionHighlightColor} color={value.highlightColor} onChange={(highlightColor) => update({ highlightColor })}/><ColorControl id="caption-outline" label={t.captionOutlineColor} color={value.outlineColor} onChange={(outlineColor) => update({ outlineColor })}/></Field>
    </div>}
  </div>
}
