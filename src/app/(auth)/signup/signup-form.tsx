'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signUpAction } from '@/lib/auth/actions';
import { IDLE_AUTH_STATE } from '@/lib/auth/types';

/**
 * The browser's own timezone is the default here, for the same reason the
 * dashboard asks the server for the time: a person signing up at 11pm should
 * not be told that tomorrow's tasks are due today.
 */
function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function SignUpForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signUpAction, IDLE_AUTH_STATE);
  const [timeZone, setTimeZone] = useState('UTC');

  useEffect(() => {
    setTimeZone(deviceTimeZone());
  }, []);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="timezone" value={timeZone} />

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
        <Label htmlFor="displayName">What should we call you?</Label>
        <Input
          id="displayName"
          name="displayName"
          autoComplete="name"
          required
          aria-invalid={state.fieldErrors?.displayName ? true : undefined}
          aria-describedby={state.fieldErrors?.displayName ? 'displayName-error' : undefined}
          placeholder="Your name"
        />
        {state.fieldErrors?.displayName ? (
          <p id="displayName-error" className="text-xs text-destructive">
            {state.fieldErrors.displayName}
          </p>
        ) : null}
      </div>

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
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          At least 8 characters, with a letter and a number.
        </p>
        {state.fieldErrors?.password ? (
          <p className="text-xs text-destructive">{state.fieldErrors.password}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={state.fieldErrors?.confirmPassword ? true : undefined}
          aria-describedby={state.fieldErrors?.confirmPassword ? 'confirmPassword-error' : undefined}
        />
        {state.fieldErrors?.confirmPassword ? (
          <p id="confirmPassword-error" className="text-xs text-destructive">
            {state.fieldErrors.confirmPassword}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" loading={pending}>
        {pending ? 'Creating your account' : 'Create account'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/login"
          className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
