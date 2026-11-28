export interface IconProps {
  className?: string
  size?: number
}

const DEFAULT_SIZE = 18

export function AppleIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  )
}

export function WindowsIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M3 4.55 10.95 3.4v7.72H3V4.55zm9.05-1.3L21 2v9.12h-8.95V3.25zM3 12.23h7.95v7.72L3 18.8v-6.57zm9.05 0H21v9.12l-8.95-1.25v-7.87z" />
    </svg>
  )
}

export function PlayIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M7 5.25 19 12 7 18.75V5.25z" />
    </svg>
  )
}

export function PauseIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect x="6.5" y="5" width="4" height="14" rx="0.75" />
      <rect x="13.5" y="5" width="4" height="14" rx="0.75" />
    </svg>
  )
}

export function SunIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.25M12 19.25v2.25M4.75 4.75l1.6 1.6M17.65 17.65l1.6 1.6M2.5 12h2.25M19.25 12h2.25M4.75 19.25l1.6-1.6M17.65 6.35l1.6-1.6" />
    </svg>
  )
}

export function MoonIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M20.25 14.5A8.5 8.5 0 0 1 9.5 3.75a8.5 8.5 0 1 0 10.75 10.75z" />
    </svg>
  )
}

export function CheckIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M4.5 12.75 9.5 17.75 19.5 6.75" />
    </svg>
  )
}

export function CopyIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  )
}

export function ExternalLinkIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5" />
    </svg>
  )
}

export function CloseIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function ChevronDownIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function MenuIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

export function HeartSupportIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M12 20.25s-7.25-4.6-8.75-9.2C2.35 8.2 4.1 5 7.45 5c1.9 0 3.45 1.05 4.55 2.55C13.1 6.05 14.65 5 16.55 5 19.9 5 21.65 8.2 20.75 11.05 19.25 15.65 12 20.25 12 20.25z" />
    </svg>
  )
}

export function CoffeeCupIcon({
  className,
  size = DEFAULT_SIZE,
  steaming = false,
}: IconProps & { steaming?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-steaming={steaming ? "true" : undefined}
      className={`coffee-icon ${className ?? ""}`.trim()}
    >
      <path className="coffee-steam coffee-steam-1" d="M7.5 6.75c0-.95.8-1.4.8-2.4" />
      <path className="coffee-steam coffee-steam-2" d="M11 6.25c0-1.05.85-1.55.85-2.75" />
      <path className="coffee-steam coffee-steam-3" d="M14.5 6.75c0-.95.8-1.4.8-2.4" />
      <g className="coffee-mug">
        <path
          className="coffee-fill"
          d="M5.6 12h10.8v1.8a4.4 4.4 0 0 1-4.4 4.4H10a4.4 4.4 0 0 1-4.4-4.4V12z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M4.75 9.5h12.5v4.25A5.25 5.25 0 0 1 12 19h-2a5.25 5.25 0 0 1-5.25-5.25V9.5z" />
        <path d="M17.25 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.8" />
      </g>
      <path className="coffee-saucer" d="M4.5 21.25h13" />
    </svg>
  )
}

export function CropReticleIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" />
      <rect x="8.5" y="6.5" width="7" height="11" rx="0.5" />
    </svg>
  )
}

export function ShieldSafeIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M12 3.25 4.75 6.25v5.4c0 4.65 3.1 7.95 7.25 9.1 4.15-1.15 7.25-4.45 7.25-9.1v-5.4L12 3.25z" />
      <rect x="9.25" y="8" width="5.5" height="8" rx="0.75" strokeDasharray="2 1.5" />
    </svg>
  )
}

export function WatermarkIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 9.25h4.5v2.5H7.5z" fill="currentColor" stroke="none" />
      <path d="M14 15.5h3" />
    </svg>
  )
}

export function AudioWaveIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M4 10.5v3M8 7v10M12 4.5v15M16 7.5v9M20 10.5v3" />
    </svg>
  )
}

export function GithubIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

export function RefreshResetIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M4.5 11.5A7.5 7.5 0 1 1 6.7 16.8" />
      <path d="M4.5 6.5v5h5" />
    </svg>
  )
}

export function VolumeOnIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M11 5.5 6.5 9.25H3.5v5.5h3L11 18.5V5.5z" />
      <path d="M15.25 9.25a4 4 0 0 1 0 5.5" />
      <path d="M18.25 6.75a7.5 7.5 0 0 1 0 10.5" />
    </svg>
  )
}

export function VolumeOffIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M11 5.5 6.5 9.25H3.5v5.5h3L11 18.5V5.5z" />
      <path d="m16 9.5 4.5 5M20.5 9.5 16 14.5" />
    </svg>
  )
}

export function ReelsPlatformIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M3.5 9h17" />
      <path d="m8.25 3.5 2.5 5.5M14.25 3.5l2.5 5.5" />
      <path d="M10.25 12.25 15 15l-4.75 2.75v-5.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function TikTokPlatformIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M15.8 3.5h-2.6v11.1a2.75 2.75 0 1 1-1.95-2.63V9.32a5.35 5.35 0 1 0 4.55 5.28V8.96a6.48 6.48 0 0 0 3.7 1.18V7.55a3.9 3.9 0 0 1-3.7-4.05z" />
    </svg>
  )
}

export function ShortsPlatformIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M16.6 4.1a3.2 3.2 0 0 1 1.3 4.35l-.95 1.75 1.1.58a3.2 3.2 0 0 1 1.3 4.35l-1.95 3.6a3.2 3.2 0 0 1-4.35 1.3l-5.65-3.05a3.2 3.2 0 0 1-1.3-4.35l.95-1.75-1.1-.58a3.2 3.2 0 0 1-1.3-4.35l1.95-3.6a3.2 3.2 0 0 1 4.35-1.3l5.65 3.05z" />
      <path d="M10.25 9.25 15.25 12l-5 2.75v-5.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PhoneCameraIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M4.5 8.5h2.2l1.4-2.25h7.8l1.4 2.25h2.2a1.75 1.75 0 0 1 1.75 1.75v7.5a1.75 1.75 0 0 1-1.75 1.75h-15a1.75 1.75 0 0 1-1.75-1.75v-7.5A1.75 1.75 0 0 1 4.5 8.5z" />
      <circle cx="12" cy="13.75" r="3.25" />
    </svg>
  )
}

export function PhoneSearchIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="m15.5 15.5 4.25 4.25" />
    </svg>
  )
}

export function PhoneMoreVertIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="12" cy="5.5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="18.5" r="1.75" />
    </svg>
  )
}

export function PhoneHeartIcon({
  className,
  size = DEFAULT_SIZE,
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? "1.2" : "1.95"}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M12 20.25s-7.4-4.7-8.9-9.45C2.15 7.9 4.05 4.75 7.45 4.75c1.95 0 3.5 1.05 4.55 2.55 1.05-1.5 2.6-2.55 4.55-2.55 3.4 0 5.3 3.15 4.35 6.05-1.5 4.75-8.9 9.45-8.9 9.45z" />
    </svg>
  )
}

export function PhoneCommentIcon({
  className,
  size = DEFAULT_SIZE,
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? "1.2" : "1.95"}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M20.25 11.75c0 4.25-3.7 7.75-8.25 7.75a8.6 8.6 0 0 1-3.35-.68L4.25 20l1.15-3.65a7.4 7.4 0 0 1-1.65-4.6C3.75 7.5 7.45 4 12 4s8.25 3.5 8.25 7.75z" />
    </svg>
  )
}

export function PhoneSharePlaneIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.95"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M21 4.25 10.5 14.5" />
      <path d="M21 4.25 14.25 20.5l-3.75-6L3.5 10.75 21 4.25z" />
    </svg>
  )
}

export function PhoneShareArrowIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M14 5.25V9.1C8.35 9.65 4.85 13.05 3.75 18.75c2.45-2.7 5.75-4.05 10.25-4.15v3.9L21 12 14 5.25z" />
    </svg>
  )
}

export function PhoneBookmarkIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M6.5 4.25h11a1.25 1.25 0 0 1 1.25 1.25v14.75L12 16.4l-6.75 3.85V5.5A1.25 1.25 0 0 1 6.5 4.25z" />
    </svg>
  )
}

export function PhoneThumbUpIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M7.25 10.25V20H4.5a1.25 1.25 0 0 1-1.25-1.25v-7.25A1.25 1.25 0 0 1 4.5 10.25h2.75zm2.25-.4 3.45-5.55a1.55 1.55 0 0 1 2.75 1.15l-.55 3.8h4.2c1.25 0 2.15 1.15 1.85 2.35l-1.45 6.2A2.4 2.4 0 0 1 17.4 19.7H9.5V9.85z" />
    </svg>
  )
}

export function PhoneThumbDownIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M16.75 13.75V4h2.75a1.25 1.25 0 0 1 1.25 1.25v7.25a1.25 1.25 0 0 1-1.25 1.25h-2.75zm-2.25.4-3.45 5.55a1.55 1.55 0 0 1-2.75-1.15l.55-3.8H4.65c-1.25 0-2.15-1.15-1.85-2.35l1.45-6.2A2.4 2.4 0 0 1 6.6 4.3h7.9v9.85z" />
    </svg>
  )
}

export function PhoneMusicNoteIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M16.75 4.25v10.1a3.1 3.1 0 1 1-1.8-2.8V7.75l-6.2 1.35v7.25a3.1 3.1 0 1 1-1.8-2.8V7.1a1.2 1.2 0 0 1 .95-1.18l7.4-1.62a1.2 1.2 0 0 1 1.45 1.15z" />
    </svg>
  )
}

export function ServerIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect x="3" y="4" width="18" height="6.5" rx="1.75" />
      <rect x="3" y="13.5" width="18" height="6.5" rx="1.75" />
      <path d="M7 7.25h.01M7 16.75h.01M11 7.25h6M11 16.75h6" />
    </svg>
  )
}

export function GlobeIcon({ className, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" />
    </svg>
  )
}
