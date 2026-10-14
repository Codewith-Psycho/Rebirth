import Link from 'next/link';

/** A 404 that offers a way back rather than a dead end. */
export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col items-start justify-center gap-5 px-5 py-16 sm:px-8"
    >
      <p className="font-serif text-sm tracking-[0.18em] text-muted-foreground">REBIRTH</p>
      <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight">
        That page is not here
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Nothing is broken and nothing was lost — the address just does not point at anything.
      </p>
      <Link
        href="/today"
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Back to today
      </Link>
    </main>
  );
}
