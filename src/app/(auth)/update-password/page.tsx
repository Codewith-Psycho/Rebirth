import type { Metadata } from 'next';
import Link from 'next/link';

import { getCurrentUser } from '@/lib/supabase/server';
import { UpdatePasswordForm } from './update-password-form';

export const metadata: Metadata = {
  title: 'Set a new password',
  description: 'Choose a new password for your REBIRTH account.',
};

export default async function UpdatePasswordPage() {
  // The reset link arrives through `/auth/callback`, which exchanges the code
  // and sets a session. Without that session there is nothing to update, and
  // the honest answer is to say so and offer a fresh link rather than showing a
  // form whose submission would fail.
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground">
            That link has expired
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Reset links are single-use and time-limited. Request a new one and it will work the same
            way.
          </p>
        </div>
        <Link
          href="/forgot-password"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground">
          Set a new password
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Signed in as {user.email ?? 'your account'}. Choose something you have not used here before.
        </p>
      </div>

      <UpdatePasswordForm />
    </div>
  );
}
