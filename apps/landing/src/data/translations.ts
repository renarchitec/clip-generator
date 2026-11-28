import type { DownloadPlatform } from './site-config.ts'

export type Locale = 'id' | 'en'

type DemoChapter = {
  number: '01' | '02' | '03' | '04'
  startSec: number
  endSec: number
  timestamp: string
  title: string
  summary: string
}

type DownloadCard = { title: string; description: string; cta: string }
type SelfHostedCard = { title: string; badge: string; arch: string; description: string; cta: string }
type SystemSpecRow = { label: string; value: string }
type SystemRequirementsPlatform = {
  minimum: SystemSpecRow[]
  recommended: SystemSpecRow[]
  note: string
}
type Comparison = { feature: string; dartclip: string; socialVisuals: string; opusClip: string; submagic: string }

export type LandingCopy = {
  meta: { title: string; description: string }
  nav: {
    brandLabel: string; links: Record<'studio' | 'demo' | 'comparison' | 'download' | 'faq', string>
    downloadCta: string; menuLabel: string; closeMenuLabel: string
    themeLightLabel: string; themeDarkLabel: string; langToggleLabel: string
  }
  hero: {
    headlineBefore: string; headlineAccent: string; headlineAfter: string
    subheadline: string; primaryCta: string; secondaryCta: string; watchDemoCta: string; metaLine: string
    monitorLabels: Record<'scene' | 'source' | 'output' | 'realRenderBadge' | 'play' | 'pause' | 'mute' | 'unmute' | 'mode' | 'sourceMode' | 'outputMode' | 'platformView' | 'platformSwitcherAria', string>
  }
  studio: {
    kicker: string; heading: string; subheading: string
    tabs: Record<'frame' | 'captions' | 'branding', string>
    aspectRatio: string; reframeMode: string; captionPreset: string
    hookToggle: string; hookInputLabel: string; hookInputPlaceholder: string; hookEmptyError: string
    safeZoneToggle: string; watermarkToggle: string; outroToggle: string; playbackToggle: string
    resetLabel: string
    realOutputLabel: string; overlayPreviewLabel: string; muteLabel: string; unmuteLabel: string; realRenderNote: string
    illustrationBadge: string; illustrationNote: string
    specs: Record<'aspectRatio' | 'reframeMode' | 'captionPreset' | 'audio' | 'hookDuration', string>
  }
  marquee: {
    eyebrow: string
    title: string
    subtitle: string
    allLabel: string
    sourceBadge: string
    pauseLabel: string
    resumeLabel: string
  }
  demo: {
    kicker: string
    heading: string
    subheading: string
    badge: string
    playLabel: string
    pauseLabel: string
    replayLabel: string
    playAria: string
    pauseAria: string
    replayAria: string
    chaptersAria: string
    timelineAria: string
    chapters: DemoChapter[]
  }
  webDemo: {
    kicker: string
    badge: string
    heading: string
    subheading: string
    highlights: string[]
    panelTitle: string
    metaRows: { label: string; value: string }[]
    primaryCta: string
    secondaryCta: string
  }
  architecture: {
    kicker: string; heading: string; subheading: string
    tableLabel: string; dartclipBadge: string; footnote: string
    columnHeaders: Comparison
    rows: Comparison[]
  }
  download: {
    kicker: string; heading: string; subheading: string; freeNote: string
    macosCard: DownloadCard; windowsCard: DownloadCard; selfHostedCard: SelfHostedCard
    requirementsJumpLabel: string
    dialog: Record<'title' | 'subtitleNotReady' | 'subtitleReady' | 'repoCta' | 'copyCommandLabel' | 'copiedLabel' | 'closeLabel', string>
  }
  systemRequirements: {
    kicker: string
    heading: string
    subheading: string
    tablistLabel: string
    tabs: Record<DownloadPlatform, string>
    minimumTitle: string
    minimumTag: string
    recommendedTitle: string
    recommendedTag: string
    platforms: Record<DownloadPlatform, SystemRequirementsPlatform>
  }
  donate: {
    heading: string; inlineNote: string; triggerLabel: string
    dialog: Record<'title' | 'subtitleNotReady' | 'subtitleReady' | 'channelNotReadyBadge' | 'openChannelCta' | 'qrAlt' | 'qrHint' | 'repoCta' | 'closeLabel', string>
  }
  faq: { kicker: string; heading: string; items: { question: string; answer: string }[] }
  closing: { headingBefore: string; headingAccent: string; subheading: string; downloadCta: string; repoCta: string }
  footer: { tagline: string; productLinksHeading: string; projectLinksHeading: string; webDemoLabel: string; privacyLabel: string; termsLabel: string; donateLabel: string; copyright: string }
}

export const TRANSLATIONS: Record<Locale, LandingCopy> = {
  id: {
    meta: {
      title: 'DartClip: Bikin klip pendek di komputer sendiri',
      description: 'Ambil momen dari YouTube, TikTok, atau Instagram. Atur framing dan caption, lalu render klip di Mac atau Windows.',
    },
    nav: {
      brandLabel: 'DartClip', links: { studio: 'Studio', demo: 'Demo', comparison: 'Perbandingan', download: 'Unduh', faq: 'FAQ' },
      downloadCta: 'Unduh Gratis', menuLabel: 'Menu', closeMenuLabel: 'Tutup menu',
      themeLightLabel: 'Pakai tema terang', themeDarkLabel: 'Pakai tema gelap', langToggleLabel: 'Switch to English',
    },
    hero: {
      headlineBefore: 'Dari video panjang', headlineAccent: 'jadi klip pendek', headlineAfter: 'di komputermu.',
      subheadline: 'Tempel URL YouTube, TikTok, atau Instagram. Pilih momennya, atur framing dan caption, lalu render di komputer sendiri tanpa langganan bulanan.',
      primaryCta: 'Unduh Gratis', secondaryCta: 'Coba Demo Web', watchDemoCta: 'Tonton video demo', metaLine: 'Gratis diunduh · Mac Apple Silicon · Windows 64-bit',
      monitorLabels: {
        scene: 'Klip contoh', source: 'Sumber', output: 'Hasil', realRenderBadge: 'Hasil render DartClip',
        play: 'Putar klip', pause: 'Jeda klip', mute: 'Matikan suara', unmute: 'Nyalakan suara',
        mode: 'Mode tampilan video', sourceMode: 'Lihat sumber', outputMode: 'Lihat klip',
        platformView: 'Tampilan platform', platformSwitcherAria: 'Pilih pratinjau platform',
      },
    },
    studio: {
      kicker: 'Pratinjau interaktif', heading: 'Coba framing dan caption',
      subheading: 'Tonton klip hasil render DartClip, atau buka pratinjau untuk mencoba layout, preset caption, dan panduan safe zone.',
      realOutputLabel: 'Hasil render asli', overlayPreviewLabel: 'Pratinjau overlay',
      muteLabel: 'Matikan suara klip', unmuteLabel: 'Nyalakan suara klip',
      realRenderNote: 'Klip ini ditampilkan sebagaimana dirender oleh DartClip. Pengaturan pratinjau tidak mengubah file video.',
      illustrationBadge: 'Ilustrasi framing',
      illustrationNote: 'Ilustrasi skema framing untuk mode ini. Mode Facecam menampilkan klip asli hasil render DartClip.',
      tabs: { frame: 'Framing', captions: 'Caption', branding: 'Branding' },
      aspectRatio: 'Rasio aspek', reframeMode: 'Mode framing', captionPreset: 'Preset caption',
      hookToggle: 'Tampilkan kartu pembuka', hookInputLabel: 'Teks kartu pembuka', hookInputPlaceholder: 'Tulis kalimat pembuka',
      hookEmptyError: 'Isi teks untuk menampilkan kartu pembuka.', safeZoneToggle: 'Panduan safe zone 9:16',
      watermarkToggle: 'Watermark contoh', outroToggle: 'Outro contoh', playbackToggle: 'Putar atau jeda pratinjau',
      resetLabel: 'Reset pratinjau',
      specs: { aspectRatio: 'Rasio output', reframeMode: 'Framing', captionPreset: 'Caption', audio: 'Target audio', hookDuration: 'Durasi kartu pembuka' },
    },
    marquee: {
      eyebrow: 'Kategori video',
      title: 'Dari Gaming, Sport, sampai Comedy',
      subtitle: 'Contoh klip vertikal dari sesi siaran game, diskusi sepak bola, sketsa komedi, sampai obrolan podcast yang dirender di DartClip.',
      allLabel: 'Semua',
      sourceBadge: 'Pratinjau ringan',
      pauseLabel: 'Jeda pratinjau',
      resumeLabel: 'Lanjutkan pratinjau',
    },
    demo: {
      kicker: 'Demo platform',
      heading: 'Dari URL sampai klip siap unggah',
      subheading: 'Tonton rekaman singkat ruang kerja DartClip, atau klik salah satu dari empat langkah untuk langsung lompat ke bagiannya.',
      badge: 'Rekaman antarmuka',
      playLabel: 'Putar',
      pauseLabel: 'Jeda',
      replayLabel: 'Ulang',
      playAria: 'Putar video demo platform',
      pauseAria: 'Jeda video demo platform',
      replayAria: 'Putar ulang video demo dari awal',
      chaptersAria: 'Langkah video demo',
      timelineAria: 'Linimasa chapter video demo',
      chapters: [
        {
          number: '01',
          startSec: 0,
          endSec: 7,
          timestamp: '00:00',
          title: 'Masukkan URL & transkrip',
          summary: 'Tempel tautan YouTube, TikTok, atau Instagram, lalu pilih sumber transkrip seperti Live Chat + STT.',
        },
        {
          number: '02',
          startSec: 7,
          endSec: 18.03,
          timestamp: '00:07',
          title: 'Pilih momen & atur framing',
          summary: 'Centang momen terbaik beserta skornya, aktifkan layout facecam, lalu cek safe zone dan pratinjau hook 9:16.',
        },
        {
          number: '03',
          startSec: 18.03,
          endSec: 27.23,
          timestamp: '00:18',
          title: 'Proses render & hasil klip',
          summary: 'Klik Buat klip, pantau progres render 5 tahap secara langsung sampai ketiga klip selesai muncul di panel Hasil.',
        },
        {
          number: '04',
          startSec: 27.23,
          endSec: 34.92,
          timestamp: '00:27',
          title: 'Jelajahi daftar klip',
          summary: 'Gulir pustaka klip hasil render, lalu buka pemutar vertikalnya untuk pratinjau dan publikasi.',
        },
      ],
    },
    webDemo: {
      kicker: 'Demo platform web',
      badge: 'Mode uji coba · Kuota terbatas',
      heading: 'Coba langsung ruang kerja DartClip di browser',
      subheading: 'Ingin menguji alur kerja sebelum mengunduh aplikasi desktop atau menjalankan self-hosted? Buka demo web untuk langsung mencoba antarmuka dan proses klipnya.',
      highlights: [
        'Bisa langsung dicoba di browser tanpa instalasi lokal.',
        'Mode demo menerapkan batas fitur dan batas jumlah klip yang bisa digenerate.',
        'Untuk akses penuh tanpa batas paket, unduh aplikasi desktop atau deploy self-hosted di server sendiri.',
      ],
      panelTitle: 'Akses Demo Web',
      metaRows: [
        { label: 'Tujuan', value: 'Uji coba alur kerja' },
        { label: 'Kuota demo', value: 'Batas fitur & jumlah klip berlaku' },
        { label: 'Akses penuh', value: 'Aplikasi desktop atau self-hosted' },
      ],
      primaryCta: 'Buka Demo Platform Web',
      secondaryCta: 'Atau lihat opsi desktop & self-hosted',
    },
    architecture: {
      kicker: 'PILIH CARA KERJAMU', heading: 'Kontennya jalan. Tanpa tagihan bulanan.',
      subheading: 'Aplikasi tetap ada di perangkatmu, bahkan saat kamu lagi rehat bikin konten.',
      tableLabel: 'Perbandingan model akses', dartclipBadge: 'GRATIS',
      columnHeaders: { feature: 'Fitur', dartclip: 'DartClip', socialVisuals: 'SocialVisuals', opusClip: 'OpusClip', submagic: 'Submagic' },
      rows: [
        { feature: 'Pembayaran', dartclip: 'Gratis diunduh', socialVisuals: 'Sekali bayar', opusClip: 'Langganan bulanan', submagic: 'Langganan bulanan' },
        { feature: 'Akses', dartclip: 'Tetap di perangkatmu', socialVisuals: 'Lifetime', opusClip: 'Selama berlangganan', submagic: 'Selama berlangganan' },
        { feature: 'Generate', dartclip: 'Tanpa limit paket', socialVisuals: 'Tanpa limit', opusClip: 'Kuota paket', submagic: 'Kuota paket' },
        { feature: 'Proses video', dartclip: 'Di perangkat', socialVisuals: 'Di perangkat', opusClip: 'Cloud', submagic: 'Cloud' },
        { feature: 'Update', dartclip: 'Termasuk', socialVisuals: 'Termasuk', opusClip: 'Ikut paket', submagic: 'Ikut paket' },
      ],
      footnote: 'Kuota dan fitur layanan pembanding mengikuti paket masing-masing. Untuk scan momen otomatis, kamu memakai API key penyedia AI milikmu sendiri.',
    },
    download: {
      kicker: 'Desktop & Self-hosted', heading: 'Unduh DartClip atau jalankan sendiri',
      subheading: 'Pilih installer desktop untuk render lokal, atau jalankan versi web secara self-hosted di server milikmu sendiri.',
      freeNote: 'Gratis diunduh dan dipakai saat ini. Tanpa paywall atau kredit bulanan yang hangus.',
      macosCard: { title: 'macOS', description: 'Installer desktop untuk Mac dengan chip Apple Silicon.', cta: 'Unduh untuk macOS' },
      windowsCard: { title: 'Windows', description: 'Installer desktop untuk Windows 10 atau 11, 64-bit.', cta: 'Unduh untuk Windows' },
      selfHostedCard: {
        title: 'Self-hosted',
        badge: 'Server sendiri',
        arch: 'Versi web penuh · Penjadwalan & multi-akun',
        description: 'Jalankan workspace web penuh di server milikmu sendiri tanpa bergantung pada akses web terkelola. Cocok untuk tim, penjadwalan klip, dan publikasi multi-akun.',
        cta: 'Panduan self-host di GitHub',
      },
      requirementsJumpLabel: 'Lihat kebutuhan sistem lengkap untuk desktop',
      dialog: {
        title: 'Installer DartClip', subtitleNotReady: 'Installer untuk platform ini belum dipublikasikan. Cek repositori untuk kabar rilis atau petunjuk build.',
        subtitleReady: 'Installer untuk platform ini sudah tersedia.', repoCta: 'Buka repositori',
        copyCommandLabel: 'Salin perintah', copiedLabel: 'Tersalin', closeLabel: 'Tutup',
      },
    },
    systemRequirements: {
      kicker: 'Kebutuhan sistem',
      heading: 'Spesifikasi untuk aplikasi desktop',
      subheading: 'Render video berlangsung langsung di komputermu. Pastikan perangkat memenuhi standar minimum berikut agar proses potong, caption, dan ekspor berjalan lancar.',
      tablistLabel: 'Pilih sistem operasi',
      tabs: { macos: 'macOS', windows: 'Windows' },
      minimumTitle: 'Minimum',
      minimumTag: 'Bisa jalan',
      recommendedTitle: 'Disarankan',
      recommendedTag: 'Render lebih cepat',
      platforms: {
        macos: {
          minimum: [
            { label: 'Sistem operasi', value: 'macOS 13 Ventura atau lebih baru' },
            { label: 'Prosesor', value: 'Apple Silicon (M1 / arm64)' },
            { label: 'Memori (RAM)', value: '8 GB unified memory' },
            { label: 'Penyimpanan', value: '2 GB ruang kosong untuk aplikasi + ruang video sumber dan hasil' },
            { label: 'Jaringan', value: 'Koneksi internet untuk ambil video dari URL dan scan AI' },
          ],
          recommended: [
            { label: 'Sistem operasi', value: 'macOS 14 Sonoma atau versi terbaru' },
            { label: 'Prosesor', value: 'Apple Silicon M2 Pro / M3 atau lebih tinggi' },
            { label: 'Memori (RAM)', value: '16 GB atau lebih untuk video stream panjang' },
            { label: 'Penyimpanan', value: 'SSD dengan minimal 10 GB ruang kosong' },
            { label: 'Jaringan', value: 'Koneksi stabil untuk unduh stream panjang dan transkripsi' },
          ],
          note: 'Mac Intel (x64) belum masuk target installer desktop saat ini.',
        },
        windows: {
          minimum: [
            { label: 'Sistem operasi', value: 'Windows 10 64-bit (21H2+) atau Windows 11' },
            { label: 'Prosesor', value: 'CPU 4-core 64-bit (Intel Core i5 atau AMD Ryzen 5)' },
            { label: 'Memori (RAM)', value: '8 GB' },
            { label: 'Penyimpanan', value: '2 GB ruang kosong untuk aplikasi + ruang video sumber dan hasil' },
            { label: 'Jaringan', value: 'Koneksi internet untuk ambil video dari URL dan scan AI' },
          ],
          recommended: [
            { label: 'Sistem operasi', value: 'Windows 11 64-bit versi terbaru' },
            { label: 'Prosesor', value: 'CPU 6-core+ 64-bit dengan akselerasi grafis modern' },
            { label: 'Memori (RAM)', value: '16 GB atau lebih untuk video stream panjang' },
            { label: 'Penyimpanan', value: 'SSD dengan minimal 10 GB ruang kosong' },
            { label: 'Jaringan', value: 'Koneksi stabil untuk unduh stream panjang dan transkripsi' },
          ],
          note: 'Hanya mendukung Windows 64-bit (x64). Sistem 32-bit tidak didukung.',
        },
      },
    },
    donate: {
      heading: 'Suka pakai DartClip? Traktir secangkir kopi.',
      inlineNote: 'DartClip gratis dipakai tanpa langganan. Kalau klipmu jadi lebih cepat kelar berkat app ini, traktiran kopi darimu ikut bantu biaya build dan update berikutnya.',
      triggerLabel: 'Traktir kopi',
      dialog: {
        title: 'Traktir kopi untuk DartClip', subtitleNotReady: 'Kanal traktiran kopi belum aktif saat ini. Terima kasih sudah ikut pakai DartClip.',
        subtitleReady: 'DartClip tetap gratis dipakai. Traktiran kopi sepenuhnya sukarela untuk membantu biaya build dan pengembangan.', channelNotReadyBadge: 'Belum aktif',
        openChannelCta: 'Buka halaman Saweria', qrAlt: 'Kode QR Saweria untuk donasi DartClip', qrHint: 'Scan lewat kamera HP atau aplikasi e-wallet', repoCta: 'Lihat di GitHub', closeLabel: 'Tutup',
      },
    },
    faq: {
      kicker: 'FAQ', heading: 'Yang sering ditanyakan',
      items: [
        { question: 'DartClip benar-benar gratis?', answer: 'Ya. Saat ini DartClip gratis diunduh dan dipakai. Tidak ada paywall atau kredit bulanan yang hangus. Donasi sukarela membantu membiayai penandatanganan build, pengerjaan aplikasi inti, dan pemeliharaan. Penyedia model atau transkripsi yang kamu pilih bisa mengenakan biaya sendiri.' },
        { question: 'Perlu API key untuk bikin klip?', answer: 'Pemilihan momen otomatis memakai akun penyedia AI dan API key milikmu sendiri. Kalau memilih rentang waktu manual dan memakai subtitle yang sudah ada, kamu tidak perlu API key sama sekali. Transkripsi audio otomatis bisa memerlukan kredensial terpisah.' },
        { question: 'Gimana kalau stream panjang tidak punya subtitle YouTube?', answer: 'Pilih mode Live Chat + Transkripsi. Kalau replay chat tersedia, DartClip mencari lonjakan aktivitas untuk menentukan bagian yang perlu ditranskrip otomatis. Kalau tidak ada replay chat atau petunjuk momen lain, DartClip tidak menjamin bisa memindai seluruh stream panjang.' },
        { question: 'Apa bedanya aplikasi desktop dan opsi self-hosted?', answer: 'Aplikasi desktop fokus pada potong, atur framing, caption, dan render lokal langsung di komputermu tanpa perlu setup server. Kalau butuh penjadwalan beberapa klip sekaligus, publikasi ke berbagai akun (YouTube Shorts, Instagram Reels, TikTok), pengaturan caption dan hashtag per platform (maksimal 15 tag kustom), pemilihan frame sampul, dan sinkronisasi data tayangan, kamu bisa men-deploy versi web secara self-hosted di server milikmu sendiri lewat repositori GitHub, bukan lewat layanan cloud pihak ketiga. Publikasi langsung dari desktop masih direncanakan.' },
        { question: 'Apakah ada versi web yang bisa dicoba langsung tanpa instalasi?', answer: 'Ya, tersedia Demo Platform Web yang bisa dibuka langsung di browser untuk mencoba alur kerja sebelum mengunduh desktop atau memasang self-hosted. Demi kestabilan server publik, mode demo menerapkan batas fitur dan batas jumlah klip yang bisa digenerate. Untuk penggunaan harian tanpa batas paket, gunakan aplikasi desktop atau jalankan self-hosted di server sendiri.' },
        { question: 'Komputer mana yang didukung aplikasi desktop?', answer: 'Target installer desktop adalah macOS di Apple Silicon (arm64, minimal macOS 13) dan Windows 10 atau 11 64-bit (x64), minimal RAM 8 GB (disarankan 16 GB). Mac Intel dan Windows 32-bit tidak termasuk target installer ini. Cek detail lengkapnya di bagian Kebutuhan sistem.' },
        { question: 'Proyek desktop disimpan di mana?', answer: 'DartClip menyimpan proyek desktop dan riwayatnya di komputermu, di ~/DartClip (folder DartClip di direktori home kamu). Render berjalan lokal, tapi pengambilan video dan layanan model atau transkrip yang kamu pilih tetap bisa memerlukan koneksi jaringan.' },
      ],
    },
    closing: {
      headingBefore: 'Sudah nemu momennya?', headingAccent: 'Bikin klipnya.',
      subheading: 'Coba satu bagian dari stream atau podcast berikutnya. Pilih rentangnya dan render di komputermu.',
      downloadCta: 'Unduh DartClip', repoCta: 'Lihat di GitHub',
    },
    footer: {
      tagline: 'Potong, atur framing, dan render klip di komputer sendiri.', productLinksHeading: 'Produk', projectLinksHeading: 'Proyek',
      webDemoLabel: 'Demo Web', privacyLabel: 'Privasi', termsLabel: 'Ketentuan', donateLabel: 'Traktir kopi', copyright: '© DartClip',
    },
  },
  en: {
    meta: {
      title: 'DartClip: Make short clips on your own computer',
      description: 'Pick moments from YouTube, TikTok, or Instagram. Reframe, add captions, and render clips on Mac or Windows.',
    },
    nav: {
      brandLabel: 'DartClip', links: { studio: 'Studio', demo: 'Demo', comparison: 'Compare', download: 'Download', faq: 'FAQ' },
      downloadCta: 'Download Free', menuLabel: 'Menu', closeMenuLabel: 'Close menu',
      themeLightLabel: 'Use light theme', themeDarkLabel: 'Use dark theme', langToggleLabel: 'Ganti ke Bahasa Indonesia',
    },
    hero: {
      headlineBefore: 'Turn long videos into', headlineAccent: 'short clips', headlineAfter: 'on your own computer.',
      subheadline: 'Paste a YouTube, TikTok, or Instagram URL. Pick the moment, set the framing and captions, then render locally with no monthly subscription.',
      primaryCta: 'Download Free', secondaryCta: 'Try Web Demo', watchDemoCta: 'Watch demo video', metaLine: 'Free to download · Apple Silicon Mac · 64-bit Windows',
      monitorLabels: {
        scene: 'Sample clip', source: 'Source', output: 'Output', realRenderBadge: 'Rendered with DartClip',
        play: 'Play clip', pause: 'Pause clip', mute: 'Mute', unmute: 'Unmute',
        mode: 'Video display mode', sourceMode: 'View source', outputMode: 'View clip',
        platformView: 'Platform view', platformSwitcherAria: 'Choose platform preview',
      },
    },
    studio: {
      kicker: 'Interactive preview', heading: 'Try the framing and captions',
      subheading: 'Watch clips rendered with DartClip, or open the preview to try layouts, caption presets, and the safe zone guide.',
      realOutputLabel: 'Original render', overlayPreviewLabel: 'Overlay preview',
      muteLabel: 'Mute clip', unmuteLabel: 'Unmute clip',
      realRenderNote: 'This clip plays as rendered by DartClip. Preview settings do not change the video file.',
      illustrationBadge: 'Framing illustration',
      illustrationNote: 'Framing schematic for this mode. Switch to Facecam to watch a real DartClip render.',
      tabs: { frame: 'Framing', captions: 'Captions', branding: 'Branding' },
      aspectRatio: 'Aspect ratio', reframeMode: 'Reframe mode', captionPreset: 'Caption preset',
      hookToggle: 'Show intro card', hookInputLabel: 'Intro card text', hookInputPlaceholder: 'Write an opening line',
      hookEmptyError: 'Enter text to show the intro card.', safeZoneToggle: '9:16 safe zone guide',
      watermarkToggle: 'Sample watermark', outroToggle: 'Sample outro', playbackToggle: 'Play or pause preview',
      resetLabel: 'Reset preview',
      specs: { aspectRatio: 'Output ratio', reframeMode: 'Framing', captionPreset: 'Captions', audio: 'Audio target', hookDuration: 'Intro card duration' },
    },
    marquee: {
      eyebrow: 'Video categories',
      title: 'Across Gaming, Sport, and Comedy',
      subtitle: 'Sample vertical clips from gaming streams, football debates, comedy sketches, and podcast talks rendered in DartClip.',
      allLabel: 'All',
      sourceBadge: 'Lightweight preview',
      pauseLabel: 'Pause previews',
      resumeLabel: 'Resume previews',
    },
    demo: {
      kicker: 'Platform demo',
      heading: 'From URL to ready-to-post clip',
      subheading: 'Watch a short walkthrough of the DartClip workspace, or click any of the four steps to jump straight to that moment.',
      badge: 'Workspace capture',
      playLabel: 'Play',
      pauseLabel: 'Pause',
      replayLabel: 'Replay',
      playAria: 'Play platform demo video',
      pauseAria: 'Pause platform demo video',
      replayAria: 'Replay platform demo from start',
      chaptersAria: 'Demo video steps',
      timelineAria: 'Demo video chapter timeline',
      chapters: [
        {
          number: '01',
          startSec: 0,
          endSec: 7,
          timestamp: '00:00',
          title: 'Paste URL & transcript mode',
          summary: 'Drop in a YouTube, TikTok, or Instagram link and pick a transcript mode like Live Chat + STT.',
        },
        {
          number: '02',
          startSec: 7,
          endSec: 18.03,
          timestamp: '00:07',
          title: 'Pick moments & framing',
          summary: 'Select top-scored moments, switch on facecam layout, and verify the 9:16 safe zone and hook card.',
        },
        {
          number: '03',
          startSec: 18.03,
          endSec: 27.23,
          timestamp: '00:18',
          title: 'Render progress & results',
          summary: 'Start rendering and follow the 5-stage progress bar live until all finished vertical clips appear in Results.',
        },
        {
          number: '04',
          startSec: 27.23,
          endSec: 34.92,
          timestamp: '00:27',
          title: 'Browse clip library',
          summary: 'Scroll through finished cuts in the Clips library and open the vertical player to preview and publish.',
        },
      ],
    },
    webDemo: {
      kicker: 'Web platform demo',
      badge: 'Trial mode · Limited quota',
      heading: 'Try the DartClip workspace right in your browser',
      subheading: 'Want to test the workflow before installing desktop or setting up self-hosting? Open the web demo to explore the workspace and try clip generation directly.',
      highlights: [
        'Runs directly in your browser with no local install required.',
        'Demo mode caps clip generation counts and restricts select features.',
        'For full unrestricted workflows, download the desktop app or self-host on your own server.',
      ],
      panelTitle: 'Web Demo Access',
      metaRows: [
        { label: 'Purpose', value: 'Live workflow preview' },
        { label: 'Demo quota', value: 'Feature & clip limits apply' },
        { label: 'Full access', value: 'Desktop app or self-hosted' },
      ],
      primaryCta: 'Open Web Platform Demo',
      secondaryCta: 'Or explore desktop & self-hosted',
    },
    architecture: {
      kicker: 'CHOOSE HOW YOU WORK', heading: 'Keep shipping clips. Skip monthly bills.',
      subheading: 'The app stays on your device, even when you take a break from posting.',
      tableLabel: 'Access model comparison', dartclipBadge: 'FREE',
      columnHeaders: { feature: 'Feature', dartclip: 'DartClip', socialVisuals: 'SocialVisuals', opusClip: 'OpusClip', submagic: 'Submagic' },
      rows: [
        { feature: 'Payment', dartclip: 'Free to download', socialVisuals: 'One-time fee', opusClip: 'Monthly subscription', submagic: 'Monthly subscription' },
        { feature: 'Access', dartclip: 'Stays on your device', socialVisuals: 'Lifetime', opusClip: 'While subscribed', submagic: 'While subscribed' },
        { feature: 'Generate', dartclip: 'No plan limit', socialVisuals: 'Unlimited', opusClip: 'Plan quota', submagic: 'Plan quota' },
        { feature: 'Video processing', dartclip: 'On device', socialVisuals: 'On device', opusClip: 'Cloud', submagic: 'Cloud' },
        { feature: 'Updates', dartclip: 'Included', socialVisuals: 'Included', opusClip: 'Tied to plan', submagic: 'Tied to plan' },
      ],
      footnote: 'Quotas and features of compared services follow their respective plans. Auto moment scanning uses your own AI provider API key.',
    },
    download: {
      kicker: 'Desktop & Self-hosted', heading: 'Download DartClip or host it yourself',
      subheading: 'Pick a desktop installer for local rendering, or run the full web workspace self-hosted on your own server.',
      freeNote: 'Free to download and use right now. No paywall or expiring monthly credits.',
      macosCard: { title: 'macOS', description: 'Desktop installer for Apple Silicon Macs.', cta: 'Download for macOS' },
      windowsCard: { title: 'Windows', description: 'Desktop installer for 64-bit Windows 10 or 11.', cta: 'Download for Windows' },
      selfHostedCard: {
        title: 'Self-hosted',
        badge: 'Your server',
        arch: 'Full web workspace · Scheduling & multi-account',
        description: 'Run the complete web workspace on your own server instead of relying on hosted web access. Built for scheduling clips and multi-account publishing.',
        cta: 'Self-host guide on GitHub',
      },
      requirementsJumpLabel: 'View full desktop system requirements',
      dialog: {
        title: 'DartClip installer', subtitleNotReady: 'The installer for this platform has not been published yet. Check the repository for release updates or build instructions.',
        subtitleReady: 'The installer for this platform is available.', repoCta: 'Open repository',
        copyCommandLabel: 'Copy command', copiedLabel: 'Copied', closeLabel: 'Close',
      },
    },
    systemRequirements: {
      kicker: 'System requirements',
      heading: 'Specs for the desktop app',
      subheading: 'Video rendering runs directly on your computer. Make sure your setup meets these baseline specs for smooth cutting, captioning, and exports.',
      tablistLabel: 'Choose operating system',
      tabs: { macos: 'macOS', windows: 'Windows' },
      minimumTitle: 'Minimum',
      minimumTag: 'Baseline',
      recommendedTitle: 'Recommended',
      recommendedTag: 'Faster renders',
      platforms: {
        macos: {
          minimum: [
            { label: 'Operating system', value: 'macOS 13 Ventura or later' },
            { label: 'Processor', value: 'Apple Silicon (M1 / arm64)' },
            { label: 'Memory (RAM)', value: '8 GB unified memory' },
            { label: 'Storage', value: '2 GB free for the app + room for source videos and exports' },
            { label: 'Network', value: 'Internet access to fetch video URLs and run AI scans' },
          ],
          recommended: [
            { label: 'Operating system', value: 'macOS 14 Sonoma or latest release' },
            { label: 'Processor', value: 'Apple Silicon M2 Pro / M3 or newer' },
            { label: 'Memory (RAM)', value: '16 GB or more for long streams' },
            { label: 'Storage', value: 'SSD with at least 10 GB free space' },
            { label: 'Network', value: 'Stable broadband for downloading long streams and transcription' },
          ],
          note: 'Intel Macs (x64) are not targeted by the current desktop installers.',
        },
        windows: {
          minimum: [
            { label: 'Operating system', value: '64-bit Windows 10 (21H2+) or Windows 11' },
            { label: 'Processor', value: '4-core 64-bit CPU (Intel Core i5 or AMD Ryzen 5)' },
            { label: 'Memory (RAM)', value: '8 GB' },
            { label: 'Storage', value: '2 GB free for the app + room for source videos and exports' },
            { label: 'Network', value: 'Internet access to fetch video URLs and run AI scans' },
          ],
          recommended: [
            { label: 'Operating system', value: 'Latest 64-bit Windows 11' },
            { label: 'Processor', value: '6-core+ 64-bit CPU with modern graphics acceleration' },
            { label: 'Memory (RAM)', value: '16 GB or more for long streams' },
            { label: 'Storage', value: 'SSD with at least 10 GB free space' },
            { label: 'Network', value: 'Stable broadband for downloading long streams and transcription' },
          ],
          note: '64-bit (x64) Windows only. 32-bit systems are not supported.',
        },
      },
    },
    donate: {
      heading: 'Enjoying DartClip? Buy me a coffee.',
      inlineNote: 'DartClip is free to use with no subscription. If it saves you time on every upload, a cup of coffee helps cover signed builds and future updates.',
      triggerLabel: 'Buy me a coffee',
      dialog: {
        title: 'Buy me a coffee', subtitleNotReady: 'Coffee support channels are not active yet. Thanks for using DartClip either way.',
        subtitleReady: 'DartClip stays free to use. Buying a coffee is completely optional and helps fund signed builds and ongoing updates.', channelNotReadyBadge: 'Not active yet',
        openChannelCta: 'Open Saweria page', qrAlt: 'Saweria QR code to support DartClip', qrHint: 'Scan with your phone camera or an e-wallet app', repoCta: 'View on GitHub', closeLabel: 'Close',
      },
    },
    faq: {
      kicker: 'FAQ', heading: 'Common questions',
      items: [
        { question: 'Is DartClip really free?', answer: 'Yes. DartClip is free to download and use right now, with no paywall or expiring monthly credits. Optional donations help pay for signed builds, core app development, and maintenance. Your choice of model or transcription provider may charge separately.' },
        { question: 'Do I need an API key to make clips?', answer: 'Automatic moment selection uses your own AI provider and API key. If you pick time ranges manually and use existing subtitles, you do not need an API key at all. Automatic audio transcription may require separate credentials.' },
        { question: 'What if a long stream has no YouTube subtitles?', answer: 'Choose Live Chat + Transcription mode. When a chat replay is available, DartClip looks for spikes in activity to decide which parts to transcribe automatically. Without a chat replay or other signals, DartClip may not be able to scan the full stream.' },
        { question: 'How do the desktop app and self-hosted option differ?', answer: 'The desktop app focuses on local cutting, framing, captions, and rendering on your computer with zero server setup. If you need batch scheduling, multi-account publishing (YouTube Shorts, Instagram Reels, TikTok), per-platform captions and hashtags (up to 15 custom tags), cover frame selection, and view-count syncing, you can self-host the web version on your own server from the GitHub repository instead of relying on managed cloud access. Direct publishing from desktop is planned.' },
        { question: 'Can I try the web workspace before installing?', answer: 'Yes, the Web Platform Demo lets you test the workspace directly in your browser before downloading desktop or deploying self-hosted. To keep the public demo server stable, demo mode applies feature limits and caps how many clips can be generated. For unrestricted daily use, download the desktop app or self-host on your own server.' },
        { question: 'Which computers are supported for the desktop app?', answer: 'Desktop installers target Apple Silicon Macs (arm64, macOS 13 or later) and 64-bit Windows 10 or 11 (x64) with at least 8 GB RAM (16 GB recommended). Intel Macs and 32-bit Windows are not supported. See the System requirements section for full specs.' },
        { question: 'Where are desktop projects stored?', answer: 'DartClip stores desktop projects and their history on your computer in ~/DartClip (the DartClip folder in your home directory). Rendering runs locally, but fetching video and using your chosen model or transcript service can still require a network connection.' },
      ],
    },
    closing: {
      headingBefore: 'Found the moment?', headingAccent: 'Make it a clip.',
      subheading: 'Try a cut from your next stream or podcast. Pick the time range and render it on your computer.',
      downloadCta: 'Download DartClip', repoCta: 'View on GitHub',
    },
    footer: {
      tagline: 'Cut, reframe, and render clips on your own computer.', productLinksHeading: 'Product', projectLinksHeading: 'Project',
      webDemoLabel: 'Web Demo', privacyLabel: 'Privacy', termsLabel: 'Terms', donateLabel: 'Buy me a coffee', copyright: '© DartClip',
    },
  },
}
