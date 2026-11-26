import { useQuery } from "@tanstack/react-query"
import { getDesktopRuntime, isDesktopBuild } from "@/lib/desktop"

export function useRuntime() {
  const desktopBuild = isDesktopBuild()
  const { data } = useQuery({
    queryKey: ["system", "runtime"],
    queryFn: getDesktopRuntime,
    // Production web doesn't need (and may not expose) the desktop endpoint.
    enabled: desktopBuild,
    staleTime: Infinity,
  })
  return {
    ...data,
    isDesktop: data?.isDesktop ?? desktopBuild,
    publishEnabled: data?.publishEnabled ?? !desktopBuild,
  }
}
