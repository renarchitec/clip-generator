import { LoaderCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type Props = Omit<React.ComponentProps<"div">, "onSubmit"> & { title: string; description: string; emailLabel: string; passwordLabel: string; submitLabel: string; footer: React.ReactNode; error?: string; pending?: boolean; onSubmit: (values: { email: string; password: string }) => void }
export function LoginForm({ className, title, description, emailLabel, passwordLabel, submitLabel, footer, error, pending, onSubmit, ...props }: Props) {
  return <div className={cn("flex flex-col gap-6", className)} {...props}><Card><CardHeader className="space-y-4 px-7 pt-8 sm:px-8"><CardTitle className="font-display text-3xl font-medium tracking-[-.05em]">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="px-7 pb-8 sm:px-8"><form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);onSubmit({email:String(data.get("email")),password:String(data.get("password"))})}}><FieldGroup><Field><FieldLabel htmlFor="email">{emailLabel}</FieldLabel><Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com"/></Field><Field><FieldLabel htmlFor="password">{passwordLabel}</FieldLabel><Input id="password" name="password" type="password" autoComplete="current-password" required/></Field>{error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Field><Button type="submit" className="mt-1 h-11 w-full rounded-xl" disabled={pending}>{pending&&<LoaderCircle className="mr-2 size-4 animate-spin"/>}{submitLabel}</Button><FieldDescription className="pt-2 text-center">{footer}</FieldDescription></Field></FieldGroup></form></CardContent></Card></div>
}
