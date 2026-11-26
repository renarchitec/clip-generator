import { ChevronLeft, ChevronRight } from "lucide-react"
import { Children, isValidElement, useRef, useState, useSyncExternalStore } from "react"
import type { Swiper as SwiperInstance } from "swiper"
import { A11y, Keyboard, Navigation, Pagination } from "swiper/modules"
import { Swiper, SwiperSlide } from "swiper/react"
import { ClipFeedProvider, type ClipCardData, type ClipFeedItem } from "@/components/clip-card"
import { useT } from "@/lib/i18n"

type AspectRatio = ClipCardData["job"]["aspectRatio"]

/** Fixed slide widths per ratio keep cards compact and identical between placeholder and ready states. */
export function carouselSlideWidth(aspectRatio: AspectRatio) {
  return aspectRatio === "16:9"
    ? "!w-[min(82vw,300px)] sm:!w-[300px]"
    : aspectRatio === "1:1"
      ? "!w-[196px] sm:!w-[216px]"
      : "!w-[164px] sm:!w-[172px]"
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)"
function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(reducedMotionQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}
function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false)
}

/** One horizontal row of clip cards; overflow scrolls via Swiper with prev/next + pagination. */
export function ClipCardCarousel({ aspectRatio, children, className = "", ...props }: { aspectRatio: AspectRatio; children: React.ReactNode; className?: string; "aria-label"?: string }) {
  const t = useT()
  const reducedMotion = usePrefersReducedMotion()
  const prevRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const paginationRef = useRef<HTMLDivElement>(null)
  const [locked, setLocked] = useState(true)
  const syncLock = (swiper: SwiperInstance) => setLocked(swiper.isLocked)
  const elements = Children.toArray(children).filter(isValidElement<{ clip?: ClipCardData; meta?: string; index?: number }>)
  const items: ClipFeedItem[] = elements.flatMap((child) => {
    const clip = child.props?.clip
    if (!clip?.id) return []
    return [{ clip, meta: typeof child.props?.meta === "string" ? child.props.meta : "", index: typeof child.props?.index === "number" ? child.props.index : undefined }]
  })

  return <ClipFeedProvider items={items}><div role="region" aria-roledescription="carousel" {...props} className={`clip-carousel min-w-0 ${className}`}>
    <Swiper
      modules={[Navigation, Pagination, Keyboard, A11y]}
      slidesPerView="auto"
      spaceBetween={12}
      breakpoints={{ 640: { spaceBetween: 16 } }}
      speed={reducedMotion ? 0 : 380}
      watchOverflow
      grabCursor
      keyboard={{ enabled: true, onlyInViewport: true }}
      a11y={{ enabled: true, prevSlideMessage: t.previousClips, nextSlideMessage: t.nextClips, paginationBulletMessage: `${t.clipPages} {{index}}` }}
      navigation={{ prevEl: prevRef.current, nextEl: nextRef.current }}
      pagination={{ el: paginationRef.current, clickable: true }}
      onBeforeInit={(swiper) => {
        if (typeof swiper.params.navigation === "object") { swiper.params.navigation.prevEl = prevRef.current; swiper.params.navigation.nextEl = nextRef.current }
        if (typeof swiper.params.pagination === "object") swiper.params.pagination.el = paginationRef.current
      }}
      onAfterInit={syncLock}
      onLock={syncLock}
      onUnlock={syncLock}
      onResize={syncLock}
      onSlidesLengthChange={syncLock}
      className="clip-carousel__swiper !p-0.5"
    >
      {elements.map((child, index) => <SwiperSlide key={child.key ?? index} className={`${carouselSlideWidth(aspectRatio)} !h-auto`}>{child}</SwiperSlide>)}
    </Swiper>
    <div className={`clip-carousel__controls mt-3 flex items-center gap-3 ${locked ? "hidden" : ""}`}>
      <div ref={paginationRef} className="clip-carousel__pagination min-w-0 flex-1" aria-label={t.clipPages}/>
      <div className="flex shrink-0 items-center gap-2">
        <button ref={prevRef} type="button" aria-label={t.previousClips} className="clip-carousel__nav grid size-10 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"><ChevronLeft className="size-4" aria-hidden="true"/></button>
        <button ref={nextRef} type="button" aria-label={t.nextClips} className="clip-carousel__nav grid size-10 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"><ChevronRight className="size-4" aria-hidden="true"/></button>
      </div>
    </div>
  </div></ClipFeedProvider>
}
