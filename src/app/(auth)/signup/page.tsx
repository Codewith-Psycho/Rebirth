import type { Metadata } from 'next';

import { SignUpForm } from './signup-form';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create your REBIRTH account.',
};

export default async function SignUpPage({
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
          Create your account
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This is a place to see what you actually did, not a place to be graded. Everything stays
          private to you.
        </p>
      </div>

      <SignUpForm next={next} />
    </div>
  );
}
