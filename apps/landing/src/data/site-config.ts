export type DownloadPlatform = 'macos' | 'windows'

export type DownloadConfig = {
  url: string | null
  arch: string
  ext: '.dmg' | '.exe'
  filename: string
}

export type DonationChannel = {
  id: string
  name: string
  url: string | null
  qrSrc?: string
  noteId: string
  noteEn: string
}

/** Public landing-page links. Only put public URLs here, never credentials or private links. */
export const SITE_CONFIG = {
  appName: 'DartClip',
  // Keep this in sync with the desktop release advertised on the landing page.
  version: 'v0.1.0',
  // Public project and policy links remain available when installers are unpublished.
  repoUrl: 'https://github.com/renarchitec/clip-generator',
  webAppUrl: 'https://clipper.rencraft.site',
  webDemoHeroUrl: 'https://clipper.rencraft.site/register?src=landing_hero',
  webDemoRegisterUrl: 'https://clipper.rencraft.site/register?src=landing_web_demo',
  privacyUrl: 'https://clipper.rencraft.site/privacy',
  termsUrl: 'https://clipper.rencraft.site/terms',
  // Paste the public installer URLs after uploading the matching files. A null URL
  // means the page should explain the release status and link to the repository.
  downloads: {
    macos: { url: null, arch: 'Apple Silicon (arm64)', ext: '.dmg', filename: 'DartClip-arm64.dmg' },
    windows: { url: null, arch: 'Windows 10/11 (64-bit)', ext: '.exe', filename: 'DartClip-setup-x64.exe' },
  } as Record<DownloadPlatform, DownloadConfig>,
  donate: {
    // Optional main donation page. Leave null until the page is live.
    primaryUrl: 'https://saweria.co/rizkyalfnsyh' as string | null,
    // Paste each channel's public donation URL when available. Leave unopened
    // channels null so the UI can mark them as unavailable rather than link to a placeholder.
    channels: [
      {
        id: 'saweria',
        name: 'Saweria',
        url: 'https://saweria.co/rizkyalfnsyh',
        qrSrc: '/donate/saweria-qr.png',
        noteId: 'Donasi dalam rupiah lewat Saweria.',
        noteEn: 'Donate in Indonesian rupiah via Saweria.',
      },
    ] as DonationChannel[],
  },
}
