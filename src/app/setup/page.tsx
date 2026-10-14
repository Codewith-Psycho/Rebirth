import { Database, KeyRound, Server } from 'lucide-react';

import { missingEnvKeys } from '@/lib/supabase/env';

/**
 * What you see when the deployment has no database.
 *
 * REBIRTH has no mock backend and no localStorage mode, so rather than
 * pretending to save things it says exactly what is missing and where to put
 * it. This page is the difference between "the app is broken" and "the app
 * needs two values".
 */
export default function SetupPage() {
  const missing = missingEnvKeys();

  const steps = [
    {
      icon: Server,
      title: '1 · Create the project',
      body: 'Make a project at supabase.com, then open Project Settings → API.',
    },
    {
      icon: KeyRound,
      title: '2 · Copy two values',
      body: 'The Project URL and the anon (publishable) key. The service-role key is never used in the browser.',
    },
    {
      icon: Database,
      title: '3 · Run the migrations',
      body: 'Apply supabase/migrations in order, then supabase/seed.sql for the quote library.',
    },
  ] as const;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col justify-center gap-8 px-5 py-16 sm:px-8">
      <div className="space-y-3">
        <p className="font-serif text-sm tracking-[0.18em] text-muted-foreground">REBIRTH</p>
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Not connected to a database yet
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Everything in REBIRTH is stored in PostgreSQL with row-level security. There is no mock
          mode, so the app will not pretend to save anything until it has somewhere real to save it.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5 shadow-subtle">
        <h2 className="font-serif text-lg font-semibold">What is missing</h2>
        <ul className="mt-3 space-y-1.5">
          {missing.map((key) => (
            <li key={key} className="flex items-center gap-2 font-mono text-sm text-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
              {key}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Copy <code className="font-mono text-foreground">.env.example</code> to{' '}
          <code className="font-mono text-foreground">.env.local</code> and fill those in, then
          restart the dev server.
        </p>
      </div>

      <ol className="space-y-4">
        {steps.map((step) => (
          <li key={step.title} className="flex gap-3">
            <step.icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">{step.title}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted-foreground">
        Full instructions, including the exact migration order, are in{' '}
        <code className="font-mono text-foreground">README.md</code>. Once the values are set and the
        dev server restarts, this page stops appearing.
      </p>
    </main>
  );
}
