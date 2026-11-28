import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { SITE_CONFIG } from './site-config.ts'
import * as studioPresets from './studio-presets.ts'
import { TRANSLATIONS } from './translations.ts'

function* collectStrings(value: unknown, path: string): Generator<[path: string, text: string]> {
  if (typeof value === 'string') {
    yield [path, value]
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      yield* collectStrings(entry, `${path}.${key}`)
    }
  }
}

function structure(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structure)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, structure(entry)]))
  }
  return typeof value
}

const bannedCopy = /\b(?:ai[\s-]+powered|revolutionary|revolusioner|seamless|next[\s-]+gen(?:eration)?|cutting[\s-]+edge|ultimate|effortless|game[\s-]+changer|unlock|elevate|empower|canggih)\b/i

for (const [name, data] of Object.entries({ id: TRANSLATIONS.id, en: TRANSLATIONS.en, studioPresets, siteConfig: SITE_CONFIG })) {
  test(`${name} copy has no em dashes, dash substitutes, or banned buzzwords`, () => {
    for (const [path, text] of collectStrings(data, name)) {
      assert.doesNotMatch(text, /\u2014| -- /, path)
      assert.doesNotMatch(text, bannedCopy, path)
    }
  })
}

test('landing copy and HTML do not name the underlying tech stack', () => {
  const forbiddenTech = /\b(?:rust|tauri|ffmpeg|yt-dlp|yunet|onnx|whisper|sqlite|nsis|loudnorm|h\.264|aac|live_chat_stt|openai|llm|lufs|oauth)\b/i
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const sources = { id: TRANSLATIONS.id, en: TRANSLATIONS.en, studioPresets, 'index.html': html }
  for (const [name, data] of Object.entries(sources)) {
    for (const [path, text] of collectStrings(data, name)) {
      assert.doesNotMatch(text, forbiddenTech, path)
    }
  }
})

test('Indonesian and English share the same copy structure', () => {
  assert.deepEqual(structure(TRANSLATIONS.id), structure(TRANSLATIONS.en))
})

test('all bundled fonts exist and caption presets point to the right font files', () => {
  const publicDir = new URL('../../public/', import.meta.url)
  for (const fontFile of Object.values(studioPresets.CAPTION_FONTS)) {
    assert.match(fontFile, /^\/fonts\/[\w-]+\.ttf$/)
    assert.ok(statSync(new URL(fontFile.slice(1), publicDir)).isFile(), fontFile)
  }
  for (const { id, fontFamily, fontFile } of studioPresets.CAPTION_PRESETS) {
    assert.equal(fontFile, studioPresets.CAPTION_FONTS[fontFamily], id)
  }
})

test('showcase clips cover all four categories in order and all render assets exist', () => {
  const publicDir = new URL('../../public/', import.meta.url)
  const { CLEAN_FACECAM_CLIP, REFRAME_MODES, SHOWCASE_CLIPS } = studioPresets
  assert.deepEqual(SHOWCASE_CLIPS.map(({ id }) => id), [
    'windah-race-hook', 'sport-ronaldo-messi', 'comedy-casting-zombie', 'podcast-kecemasan',
  ])
  assert.deepEqual(SHOWCASE_CLIPS.map(({ category }) => category), ['gaming', 'sport', 'comedy', 'podcast'])
  assert.equal(SHOWCASE_CLIPS[0].mode, 'facecam')
  assert.equal(CLEAN_FACECAM_CLIP.id, 'windah-clean-facecam')
  assert.equal(CLEAN_FACECAM_CLIP.category, 'gaming')
  assert.equal(CLEAN_FACECAM_CLIP.mode, 'facecam')
  for (const { id, mode, aspectRatio, durationSec, videoSrc, posterSrc } of [...SHOWCASE_CLIPS, CLEAN_FACECAM_CLIP]) {
    assert.equal(aspectRatio, '9:16', id)
    assert.equal(durationSec, 10, id)
    assert.ok(REFRAME_MODES.some((reframe) => reframe.id === mode && reframe.aspectRatios.includes(aspectRatio)), `${id}: ${mode}`)
    assert.equal(videoSrc, `/clips/${id}.mp4`)
    assert.equal(posterSrc, `/clips/${id}-poster.jpg`)
    for (const path of [videoSrc, posterSrc]) {
      const file = statSync(new URL(path.slice(1), publicDir))
      assert.ok(file.isFile() && file.size > 0, path)
    }
  }
})

test('all eight marquee cards have lightweight posters and loops, with two clips per category', () => {
  const publicDir = new URL('../../public/', import.meta.url)
  const { MARQUEE_CLIPS, VIDEO_CATEGORIES } = studioPresets
  const categoryIds = VIDEO_CATEGORIES.map(({ id }) => id)
  assert.deepEqual(categoryIds, ['gaming', 'sport', 'comedy', 'podcast'])
  assert.equal(MARQUEE_CLIPS.length, 8)
  assert.equal(new Set(MARQUEE_CLIPS.map(({ id }) => id)).size, 8)
  assert.deepEqual(MARQUEE_CLIPS.map(({ category }) => category), [...categoryIds, ...categoryIds])

  for (const { id, imageSrc, previewSrc, titleId, titleEn } of MARQUEE_CLIPS) {
    assert.match(imageSrc, /^\/marquee\/[\w-]+\.jpg$/)
    assert.equal(imageSrc, `/marquee/${id}.jpg`)
    const file = statSync(new URL(imageSrc.slice(1), publicDir))
    assert.ok(file.isFile(), imageSrc)
    assert.ok(file.size > 0 && file.size <= 65_536, `${imageSrc}: ${file.size} bytes`)
    assert.equal(previewSrc, `/marquee/${id}.mp4`)
    const preview = statSync(new URL(previewSrc.slice(1), publicDir))
    assert.ok(preview.isFile() && preview.size > 0 && preview.size <= 98_304, `${previewSrc}: ${preview.size} bytes`)
    for (const [field, copy] of Object.entries({ titleId, titleEn })) {
      assert.ok(copy.trim(), `${id}: ${field} must not be blank`)
    }
  }
})

test('only Facecam maps to a real render in ClipStudio', () => {
  const { SHOWCASE_CLIPS, SHOWCASE_CLIPS_BY_MODE } = studioPresets
  assert.deepEqual(Object.keys(SHOWCASE_CLIPS_BY_MODE), ['facecam'])
  assert.equal(SHOWCASE_CLIPS_BY_MODE.facecam, SHOWCASE_CLIPS[0])
})

test('platform demo video, poster, and four chapters are valid in both locales', () => {
  const publicDir = new URL('../../public/', import.meta.url)
  const { PLATFORM_DEMO_VIDEO } = studioPresets
  assert.equal(PLATFORM_DEMO_VIDEO.videoSrc, '/demo/platform-demo.mp4')
  assert.equal(PLATFORM_DEMO_VIDEO.posterSrc, '/demo/platform-demo-poster.jpg')
  for (const assetPath of [PLATFORM_DEMO_VIDEO.videoSrc, PLATFORM_DEMO_VIDEO.posterSrc]) {
    const file = statSync(new URL(assetPath.slice(1), publicDir))
    assert.ok(file.isFile() && file.size > 0, assetPath)
  }

  for (const [locale, { demo, nav }] of Object.entries(TRANSLATIONS)) {
    assert.equal(nav.links.demo, 'Demo', locale)
    assert.equal(demo.chapters.length, 4, locale)
    assert.deepEqual(
      demo.chapters.map(({ number }) => number),
      ['01', '02', '03', '04'],
      locale,
    )
    for (let i = 0; i < demo.chapters.length; i++) {
      const ch = demo.chapters[i]
      assert.ok(ch.startSec >= 0 && ch.endSec > ch.startSec && ch.endSec <= PLATFORM_DEMO_VIDEO.durationSec, `${locale}: ${ch.number}`)
      if (i > 0) {
        assert.equal(ch.startSec, demo.chapters[i - 1].endSec, `${locale}: chapter ${ch.number} continuity`)
      }
    }
  }
})

test('all five comparison rows include SocialVisuals in both locales', () => {
  for (const [locale, { architecture }] of Object.entries(TRANSLATIONS)) {
    assert.equal(architecture.columnHeaders.socialVisuals, 'SocialVisuals', locale)
    assert.equal(architecture.rows.length, 5, locale)
    for (const row of architecture.rows) {
      assert.ok(row.socialVisuals?.trim(), `${locale}: ${row.feature}`)
    }
  }
})

function assertPublicHttpsLink(link: string) {
  const url = new URL(link)
  assert.equal(url.protocol, 'https:', link)
  assert.ok(url.hostname.includes('.'), link)
  assert.equal(url.username + url.password, '', link)
}

test('site config supplies valid HTTPS fallback links', () => {
  const { repoUrl, webAppUrl, webDemoHeroUrl, webDemoRegisterUrl, privacyUrl, termsUrl } = SITE_CONFIG
  for (const link of [repoUrl, webAppUrl, webDemoHeroUrl, webDemoRegisterUrl, privacyUrl, termsUrl]) assertPublicHttpsLink(link)
})

test('site config supports optional donation links without preset amounts', () => {
  const publicDir = new URL('../../public/', import.meta.url)
  const { donate } = SITE_CONFIG
  assert.deepEqual(Object.keys(donate).sort(), ['channels', 'primaryUrl'])
  assert.ok(donate.channels.length > 0)
  assert.equal(new Set(donate.channels.map(({ id }) => id)).size, donate.channels.length)
  for (const link of [donate.primaryUrl, ...donate.channels.map(({ url }) => url)]) {
    if (link !== null) assertPublicHttpsLink(link)
  }
  for (const { id, qrSrc } of donate.channels) {
    if (qrSrc) {
      assert.match(qrSrc, /^\/donate\/[\w-]+\.(?:png|jpg|webp)$/, id)
      const file = statSync(new URL(qrSrc.slice(1), publicDir))
      assert.ok(file.isFile() && file.size > 0, qrSrc)
    }
  }
})

test('web demo CTA, self-hosted option, system requirements, and FAQ copy are complete in both locales', () => {
  for (const [locale, copy] of Object.entries(TRANSLATIONS)) {
    assert.ok(copy.webDemo.primaryCta.trim(), `${locale}: webDemo CTA`)
    assert.ok(copy.webDemo.highlights.length >= 2, `${locale}: webDemo highlights`)
    assert.ok(copy.download.selfHostedCard.cta.trim(), `${locale}: selfHostedCard CTA`)
    for (const os of ['macos', 'windows'] as const) {
      assert.equal(copy.systemRequirements.platforms[os].minimum.length, 5, `${locale}: ${os} minimum specs`)
      assert.equal(copy.systemRequirements.platforms[os].recommended.length, 5, `${locale}: ${os} recommended specs`)
      assert.ok(copy.systemRequirements.platforms[os].note.trim(), `${locale}: ${os} note`)
    }
    const faqText = copy.faq.items.map((item) => `${item.question} ${item.answer}`).join(' ').toLowerCase()
    assert.match(faqText, /self-host/, `${locale}: FAQ mentions self-hosting`)
    assert.match(faqText, /demo/, `${locale}: FAQ mentions web demo limits`)
  }
})
