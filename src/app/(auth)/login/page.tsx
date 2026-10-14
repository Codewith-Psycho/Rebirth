import type { Metadata } from 'next';

import { SignInForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to REBIRTH.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '/today';

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground">
          Welcome back
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Pick up where you left off. Nothing was lost while you were away.
        </p>
      </div>

      <SignInForm next={next} />
    </div>
  );
}
