import { useForm } from "@tanstack/react-form"
import { LoaderCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"

type Props = Omit<React.ComponentProps<"div">, "onSubmit"> & { title: string; description: string; emailLabel: string; passwordLabel: string; submitLabel: string; footer: React.ReactNode; topSlot?: React.ReactNode; error?: string; pending?: boolean; onSubmit: (values: { email: string; password: string }) => void }
type Values = { email: string; password: string }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function LoginForm({ className, title, description, emailLabel, passwordLabel, submitLabel, footer, topSlot, error, pending, onSubmit, ...props }: Props) {
  const t = useT()
  const form = useForm({
    defaultValues: { email: "", password: "" } as Values,
    onSubmit: ({ value }) => onSubmit(value),
  })
  return <div className={cn("flex flex-col gap-6", className)} {...props}><Card className="rounded-lg border-border bg-card shadow-none"><CardHeader className="space-y-2 px-6 pt-6 sm:px-7 sm:pt-7"><CardTitle className="font-display text-2xl font-medium tracking-[-.04em]">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="px-6 pb-6 sm:px-7 sm:pb-7">{topSlot}<form noValidate onSubmit={(event) => { event.preventDefault(); void form.handleSubmit() }}><FieldGroup>
    <form.Field name="email" validators={{ onChange: ({ value }) => !value.trim() ? t.emailRequired : !EMAIL.test(value.trim()) ? t.emailInvalid : undefined }}>
      {(field) => <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
        <FieldLabel htmlFor="email">{emailLabel}</FieldLabel>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} onBlur={field.handleBlur} aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid} aria-required="true" />
        {field.state.meta.isTouched && field.state.meta.errors.length > 0 && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}
      </Field>}
    </form.Field>
    <form.Field name="password" validators={{ onChange: ({ value }) => !value ? t.passwordRequired : undefined }}>
      {(field) => <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
        <FieldLabel htmlFor="password">{passwordLabel}</FieldLabel>
        <Input id="password" name="password" type="password" autoComplete="current-password" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} onBlur={field.handleBlur} aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid} aria-required="true" />
        {field.state.meta.isTouched && field.state.meta.errors.length > 0 && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}
      </Field>}
    </form.Field>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => <Field><Button type="submit" className="mt-1 h-11 w-full rounded-md" disabled={pending || isSubmitting || !canSubmit}>{pending && <LoaderCircle className="mr-2 size-4 animate-spin" />}{submitLabel}</Button><FieldDescription className="pt-2 text-center">{footer}</FieldDescription></Field>}
    </form.Subscribe>
  </FieldGroup></form></CardContent></Card></div>
}
