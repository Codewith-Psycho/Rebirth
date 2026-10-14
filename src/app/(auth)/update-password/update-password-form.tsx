'use client';

import { useActionState } from 'react';
import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updatePasswordAction } from '@/lib/auth/actions';
import { IDLE_AUTH_STATE } from '@/lib/auth/types';

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, IDLE_AUTH_STATE);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.status === 'error' && state.message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-border bg-destructive-soft px-3 py-2.5 text-sm text-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{state.message}</span>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
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
        <Label htmlFor="confirmPassword">Confirm new password</Label>
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
        {pending ? 'Saving' : 'Set new password'}
      </Button>
    </form>
  );
}
