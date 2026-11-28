export const ASPECT_RATIOS = ['9:16', '1:1', '16:9'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

export type ReframeModeId = 'center_crop' | 'face_tracking' | 'facecam' | 'two_speakers' | 'blurred_fill' | 'black_bars'

export type ReframeMode = {
  id: ReframeModeId
  labelId: string
  labelEn: string
  descriptionId: string
  descriptionEn: string
  aspectRatios: readonly AspectRatio[]
}

// The Rust renderer uses blurred fill for landscape, regardless of the requested mode.
export const REFRAME_MODES: readonly ReframeMode[] = [
  {
    id: 'center_crop', labelId: 'Crop tengah', labelEn: 'Center crop',
    descriptionId: 'Potong sisi gambar, pertahankan bagian tengah. Ini mode bawaan.',
    descriptionEn: 'Trim the edges and keep the center. This is the default mode.',
    aspectRatios: ['9:16', '1:1'],
  },
  {
    id: 'face_tracking', labelId: 'Pembicara aktif', labelEn: 'Active speaker',
    descriptionId: 'Geser crop mengikuti pembicara aktif dengan deteksi wajah otomatis.',
    descriptionEn: 'Move the crop to follow the active speaker with automatic face detection.',
    aspectRatios: ['9:16', '1:1'],
  },
  {
    id: 'facecam', labelId: 'Facecam streamer', labelEn: 'Streamer facecam',
    descriptionId: 'Facecam di 43,75% bagian atas, gameplay 1:1 di bawah.',
    descriptionEn: 'Facecam takes the top 43.75%, with square gameplay below.',
    aspectRatios: ['9:16'],
  },
  {
    id: 'two_speakers', labelId: 'Dua pembicara', labelEn: 'Two speakers',
    descriptionId: 'Tumpuk dua panel supaya kedua pembicara tetap terlihat.',
    descriptionEn: 'Stack two panels to keep both speakers in view.',
    aspectRatios: ['9:16'],
  },
  {
    id: 'blurred_fill', labelId: 'Latar buram', labelEn: 'Blurred fill',
    descriptionId: 'Pertahankan gambar utuh dan isi ruang kosong dengan latar buram.',
    descriptionEn: 'Keep the full image and fill the empty space with a blurred background.',
    aspectRatios: ASPECT_RATIOS,
  },
  {
    id: 'black_bars', labelId: 'Bilah hitam', labelEn: 'Black bars',
    descriptionId: 'Pertahankan gambar utuh dan isi ruang kosong dengan bilah hitam.',
    descriptionEn: 'Keep the full image and fill the empty space with black bars.',
    aspectRatios: ['9:16', '1:1'],
  },
]

export type VideoCategoryId = 'gaming' | 'sport' | 'comedy' | 'podcast'

export type VideoCategory = {
  id: VideoCategoryId
  labelId: string
  labelEn: string
}

export const VIDEO_CATEGORIES: readonly VideoCategory[] = [
  { id: 'gaming', labelId: 'Gaming', labelEn: 'Gaming' },
  { id: 'sport', labelId: 'Sport', labelEn: 'Sport' },
  { id: 'comedy', labelId: 'Comedy', labelEn: 'Comedy' },
  { id: 'podcast', labelId: 'Podcast', labelEn: 'Podcast' },
]

export type ShowcaseClip = {
  id: string
  category: VideoCategoryId
  mode: ReframeModeId
  aspectRatio: AspectRatio
  videoSrc: `/clips/${string}.mp4`
  posterSrc: `/clips/${string}-poster.jpg`
  labelId: string
  labelEn: string
  metaId: string
  metaEn: string
  durationSec: 10
}

// These are finished DartClip renders, separate from the interactive overlay preview.
export const SHOWCASE_CLIPS = [
  {
    id: 'windah-race-hook', category: 'gaming', mode: 'facecam', aspectRatio: '9:16',
    videoSrc: '/clips/windah-race-hook.mp4', posterSrc: '/clips/windah-race-hook-poster.jpg',
    labelId: 'Balapan Supercar', labelEn: 'Supercar Street Race',
    metaId: 'Gaming · 9:16 · Klip Windah Basudara', metaEn: 'Gaming · 9:16 · Windah Basudara clip', durationSec: 10,
  },
  {
    id: 'sport-ronaldo-messi', category: 'sport', mode: 'center_crop', aspectRatio: '9:16',
    videoSrc: '/clips/sport-ronaldo-messi.mp4', posterSrc: '/clips/sport-ronaldo-messi-poster.jpg',
    labelId: '1000 Gol Ronaldo vs Piala Dunia Messi', labelEn: 'Ronaldo’s 1,000 Goals vs. Messi’s World Cup',
    metaId: 'Sport · 9:16 · Klip Podcast Bola', metaEn: 'Sport · 9:16 · Football Podcast Clip', durationSec: 10,
  },
  {
    id: 'comedy-casting-zombie', category: 'comedy', mode: 'blurred_fill', aspectRatio: '9:16',
    videoSrc: '/clips/comedy-casting-zombie.mp4', posterSrc: '/clips/comedy-casting-zombie-poster.jpg',
    labelId: 'Casting Zombie Paling Absurd', labelEn: 'Most Absurd Zombie Audition',
    metaId: 'Comedy · 9:16 · Klip Tretan Universe', metaEn: 'Comedy · 9:16 · Tretan Universe Clip', durationSec: 10,
  },
  {
    id: 'podcast-kecemasan', category: 'podcast', mode: 'center_crop', aspectRatio: '9:16',
    videoSrc: '/clips/podcast-kecemasan.mp4', posterSrc: '/clips/podcast-kecemasan-poster.jpg',
    labelId: 'Sumber Kecemasan Hidup: Terlalu Ikut Campur Urusan Tuhan', labelEn: 'Source of Anxiety: Meddling in God’s Affairs',
    metaId: 'Podcast · 9:16 · Klip SUARA BERKELAS', metaEn: 'Podcast · 9:16 · SUARA BERKELAS Clip', durationSec: 10,
  },
] as const satisfies readonly ShowcaseClip[]

// Other reframe modes in ClipStudio show framing illustrations instead of rendered clips.
export const SHOWCASE_CLIPS_BY_MODE: Readonly<Partial<Record<ReframeModeId, ShowcaseClip>>> = {
  facecam: SHOWCASE_CLIPS[0],
}

export const CLEAN_FACECAM_CLIP = {
  id: 'windah-clean-facecam', category: 'gaming', mode: 'facecam', aspectRatio: '9:16',
  videoSrc: '/clips/windah-clean-facecam.mp4', posterSrc: '/clips/windah-clean-facecam-poster.jpg',
  labelId: 'Misi Kabin Senjata', labelEn: 'Cabin Weapon Run',
  metaId: 'Gaming · 9:16 · Klip Windah Basudara', metaEn: 'Gaming · 9:16 · Windah Basudara clip', durationSec: 10,
} as const satisfies ShowcaseClip

export type MarqueeClip = {
  id: string
  category: VideoCategoryId
  imageSrc: string
  previewSrc: string
  duration: string
  aspectRatio: '9:16'
  titleId: string
  titleEn: string
}

// Durations refer to the full renders, not the autoplay previews.
const marqueeCards: Omit<MarqueeClip, 'previewSrc'>[] = [
  {
    id: 'gaming-supercar', category: 'gaming', imageSrc: '/marquee/gaming-supercar.jpg', duration: '0:45', aspectRatio: '9:16',
    titleId: 'Baru Mau Skill Langsung Dikeroyok', titleEn: 'Ganged Up Mid Street Race',
  },
  {
    id: 'sport-ronaldo-messi', category: 'sport', imageSrc: '/marquee/sport-ronaldo-messi.jpg', duration: '2:06', aspectRatio: '9:16',
    titleId: '1000 Gol Ronaldo vs Piala Dunia Messi', titleEn: 'Ronaldo 1000 Goals vs Messi World Cup',
  },
  {
    id: 'comedy-casting-zombie', category: 'comedy', imageSrc: '/marquee/comedy-casting-zombie.jpg', duration: '1:03', aspectRatio: '9:16',
    titleId: 'Casting Zombie Paling Absurd', titleEn: 'Most Absurd Zombie Audition',
  },
  {
    id: 'podcast-kecemasan', category: 'podcast', imageSrc: '/marquee/podcast-kecemasan.jpg', duration: '2:10', aspectRatio: '9:16',
    titleId: 'Sumber Kecemasan Hidup: Terlalu Ikut Campur Urusan Tuhan', titleEn: 'Source of Anxiety: Meddling in God’s Affairs',
  },
  {
    id: 'gaming-freestyle', category: 'gaming', imageSrc: '/marquee/gaming-freestyle.jpg', duration: '0:34', aspectRatio: '9:16',
    titleId: 'Misi Kabur Sambil Freestyle', titleEn: 'Bridge Chase Escape Run',
  },
  {
    id: 'sport-madrid-ucl', category: 'sport', imageSrc: '/marquee/sport-madrid-ucl.jpg', duration: '2:33', aspectRatio: '9:16',
    titleId: 'Real Madrid Pesta 5 Gol di UCL', titleEn: 'Real Madrid 5-Goal UCL Night',
  },
  {
    id: 'comedy-tretan-bene', category: 'comedy', imageSrc: '/marquee/comedy-tretan-bene.jpg', duration: '1:03', aspectRatio: '9:16',
    titleId: 'Juri Ngakak Lihat Akting Zombie', titleEn: 'Judges Crack Up at Zombie Acting',
  },
  {
    id: 'podcast-usaha', category: 'podcast', imageSrc: '/marquee/podcast-usaha.jpg', duration: '1:58', aspectRatio: '9:16',
    titleId: 'Membantah Ungkapan Usaha Tidak Mengkhianati Hasil', titleEn: 'Challenging the Saying Effort Never Betrays Results',
  },
]

export const MARQUEE_CLIPS: readonly MarqueeClip[] = marqueeCards.map((card) => ({
  ...card,
  previewSrc: `/marquee/${card.id}.mp4`,
}))

export const CAPTION_FONTS = {
  Anton: '/fonts/Anton-Regular.ttf',
  'Bebas Neue': '/fonts/BebasNeue-Regular.ttf',
  Montserrat: '/fonts/Montserrat-Bold.ttf',
  'Plus Jakarta Sans': '/fonts/PlusJakartaSans-Bold.ttf',
  Oswald: '/fonts/Oswald-Bold.ttf',
  Bangers: '/fonts/Bangers-Regular.ttf',
} as const

export type CaptionPresetId = 'hook' | 'beast' | 'boxed' | 'neon' | 'cinema'
export type CaptionPreset = {
  id: CaptionPresetId
  label: string
  fontFamily: keyof typeof CAPTION_FONTS
  fontFile: (typeof CAPTION_FONTS)[keyof typeof CAPTION_FONTS]
  fontSize: number
  textColor: `#${string}`
  highlightColor: `#${string}`
  outlineColor: `#${string}`
  effect: 'outline' | 'box' | 'shadow'
  uppercase: boolean
  animate: boolean
}

// Values mirror CaptionStyle::from_preset in dartclip-core. Bangers is bundled for custom captions.
export const CAPTION_PRESETS: readonly CaptionPreset[] = [
  {
    id: 'hook', label: 'Hook', fontFamily: 'Anton', fontFile: CAPTION_FONTS.Anton,
    fontSize: 80, textColor: '#FFFFFF', highlightColor: '#FFFF00', outlineColor: '#000000',
    effect: 'outline', uppercase: true, animate: true,
  },
  {
    id: 'beast', label: 'Beast', fontFamily: 'Montserrat', fontFile: CAPTION_FONTS.Montserrat,
    fontSize: 84, textColor: '#FFFFFF', highlightColor: '#22C55E', outlineColor: '#000000',
    effect: 'outline', uppercase: true, animate: true,
  },
  {
    id: 'boxed', label: 'Boxed', fontFamily: 'Plus Jakarta Sans', fontFile: CAPTION_FONTS['Plus Jakarta Sans'],
    fontSize: 68, textColor: '#FFFFFF', highlightColor: '#FACC15', outlineColor: '#000000',
    effect: 'box', uppercase: false, animate: false,
  },
  {
    id: 'neon', label: 'Neon', fontFamily: 'Bebas Neue', fontFile: CAPTION_FONTS['Bebas Neue'],
    fontSize: 92, textColor: '#FFFFFF', highlightColor: '#5CE1C4', outlineColor: '#09090B',
    effect: 'shadow', uppercase: true, animate: false,
  },
  {
    id: 'cinema', label: 'Cinema', fontFamily: 'Oswald', fontFile: CAPTION_FONTS.Oswald,
    fontSize: 68, textColor: '#FEF08A', highlightColor: '#FFFFFF', outlineColor: '#000000',
    effect: 'shadow', uppercase: false, animate: false,
  },
]

// Scripted words for the demo monitor, not creator quotes or testimonials.
export const SAMPLE_LINES: Record<'id' | 'en', string[]> = {
  id: ['Tunggu,', 'dia', 'masih', 'punya', 'satu', 'peluru.'],
  en: ['Wait,', 'they', 'still', 'have', 'one', 'bullet.'],
}

export const PLATFORM_DEMO_VIDEO = {
  videoSrc: '/demo/platform-demo.mp4',
  posterSrc: '/demo/platform-demo-poster.jpg',
  durationSec: 34.92,
  width: 1280,
  height: 720,
} as const
