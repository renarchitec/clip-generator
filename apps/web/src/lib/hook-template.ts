export const hookTemplates = ["editorial", "bold_box", "paper_cut", "neon_pulse", "breaking", "comic_pop"] as const
export type HookTemplate = typeof hookTemplates[number]
export function parseHookTemplate(value: unknown): HookTemplate {
  return hookTemplates.find(key => key === value) ?? "editorial"
}
