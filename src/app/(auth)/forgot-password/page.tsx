import type { Metadata } from 'next';

import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Reset your password',
  description: 'Request a password reset link.',
};

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground">
          Reset your password
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Tell us the address you signed up with and we will send a link to set a new password.
        </p>
      </div>

      <ForgotPasswordForm />
    </div>
  );
}
