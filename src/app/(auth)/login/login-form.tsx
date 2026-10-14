'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { AlertCircle, MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInAction } from '@/lib/auth/actions';
import { IDLE_AUTH_STATE } from '@/lib/auth/types';

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signInAction, IDLE_AUTH_STATE);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.status === 'error' && state.message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-border bg-destructive-soft px-3 py-2.5 text-sm text-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{state.message}</span>
        </div>
      ) : null}

      {state.status === 'sent' && state.message ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-success-soft px-3 py-2.5 text-sm text-foreground"
        >
          <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{state.message}</span>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          placeholder="you@example.com"
        />
        {state.fieldErrors?.email ? (
          <p id="email-error" className="text-xs text-destructive">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Forgot it?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          aria-describedby={state.fieldErrors?.password ? 'password-error' : undefined}
        />
        {state.fieldErrors?.password ? (
          <p id="password-error" className="text-xs text-destructive">
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? 'Signing in' : 'Sign in'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        No account yet?{' '}
        <Link
          href="/signup"
          className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
