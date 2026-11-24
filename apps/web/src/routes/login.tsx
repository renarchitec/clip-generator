import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { LoginForm } from "@/components/login-form"
import { Brand, Preferences } from "@/components/chrome"
import { LegalFooterLinks } from "@/components/legal-page"
import { api, safeRedirectTarget } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { getCurrentUser } from "@/lib/auth"

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({ redirect: safeRedirectTarget(search.redirect) }),
  beforeLoad: async () => { if (await getCurrentUser()) throw redirect({ to: "/" }) },
  component: LoginPage,
})
function LoginPage() {
  const t = useT(); const navigate = useNavigate(); const [error, setError] = useState("")
  const { redirect: redirectTarget } = Route.useSearch()
  const safeRedirect = safeRedirectTarget(redirectTarget)
  const registration = useQuery({ queryKey:["auth","config"], queryFn:()=>api<{registrationOpen:boolean}>("/auth/config") })
  const mutation=useMutation({mutationFn:(body:{email:string;password:string})=>api("/auth/login",{method:"POST",body:JSON.stringify(body)}),onSuccess:()=>safeRedirect?navigate({href:safeRedirect}):navigate({to:"/"}),onError:(e:Error)=>setError((e as Error & {status?:number}).status===401?t.error:t.apiError)})
  return <main className="flex min-h-screen flex-col bg-background">
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-6"><Brand/><Preferences/></header>
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">
      <LoginForm className="w-full max-w-[400px]" title={t.logIn} description={t.appDesc} emailLabel={t.email} passwordLabel={t.password} submitLabel={t.logIn} error={mutation.isError?error:undefined} pending={mutation.isPending} onSubmit={(values)=>{setError("");mutation.mutate(values)}} footer={<>{t.noAccount} {registration.data?.registrationOpen&&<Link to="/register" search={safeRedirect?{redirect:safeRedirect}:{}} className="font-medium text-primary underline-offset-4 hover:underline">{t.signUp}</Link>}</>}/>
    </div>
    <footer className="px-4 pb-5 text-center text-xs text-muted-foreground"><LegalFooterLinks className="mb-1"/>© DartClip</footer>
  </main>
}
