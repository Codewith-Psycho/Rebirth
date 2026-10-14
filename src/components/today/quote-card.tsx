'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronDown, ExternalLink, Quote as QuoteIcon, Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listRecentDeliveries, setQuoteFavorite } from '@/lib/data/quotes';
import type { DailyQuoteResult } from '@/lib/types/database';
import type { DayKey } from '@/lib/domain/time';
import { useSupabase, useViewer } from '@/lib/hooks/use-viewer';
import { useAsync } from '@/lib/hooks/use-async';
import { LoadingBlock } from '@/components/common/states';
import type { Mutator } from '@/components/tasks/types';
import { cn } from '@/lib/utils';

/** One previously delivered line, as the history call returns it. */
interface QuoteDeliveryEntry {
  delivered_on: DayKey;
  quote: { id: string; body: string; attribution: string | null; source_title: string | null; content_type: 'verified' | 'original' };
}

/**
 * One line, attributed honestly.
 *
 * The card is built so that misattribution is structurally difficult:
 *
 *   · a `verified` line always shows who said it, in what, and where the line
 *     was checked — a quotation without provenance is not printed as somebody's
 *     words;
 *   · an `original` line is labelled as written for this app and carries no
 *     attribution at all;
 *   · and when the library has nothing to offer, the card is simply absent
 *     rather than inventing a quote, because a fabricated line attributed to a
 *     real character is a lie told in the user's own app.
 */

export function QuoteCard({ quote, mutate }: { quote: DailyQuoteResult; mutate: Mutator }) {
  const supabase = useSupabase();
  const viewer = useViewer();
  const [favorite, setFavorite] = useState(quote.is_favorite);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const history = useAsync(
    () => listRecentDeliveries(supabase, 14),
    { enabled: historyOpen, key: `quotes:${viewer.userId}:history` },
  );

  // Today's line is shown above; the list is what came before it.
  const previous = (history.data ?? []).filter((entry) => entry.quote.id !== quote.id).slice(0, 8);

  async function toggleFavorite() {
    const next = !favorite;
    setBusy(true);
    const result = await mutate(() => setQuoteFavorite(supabase, viewer.userId, quote.id, next), {
      quiet: true,
    });
    setBusy(false);
    if (result.ok) setFavorite(next);
  }

  const isVerified = quote.content_type === 'verified';

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3.5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <QuoteIcon className="size-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant={isVerified ? 'muted' : 'outline'}>
              {isVerified ? 'Verified quotation' : 'Written for REBIRTH'}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void toggleFavorite()}
              loading={busy}
              aria-label={favorite ? 'Remove from favourites' : 'Save to favourites'}
              aria-pressed={favorite}
            >
              <Star
                className={cn('size-4', favorite && 'fill-accent text-accent')}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>

        <blockquote className="font-serif text-xl leading-relaxed text-foreground sm:text-2xl">
          {quote.body}
        </blockquote>

        <div className="space-y-1">
          {isVerified ? (
            <>
              <p className="text-sm text-foreground">
                {quote.attribution}
                {quote.source_title ? (
                  <span className="text-muted-foreground"> — {quote.source_title}</span>
                ) : null}
              </p>
              {quote.language_note ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{quote.language_note}</p>
              ) : null}
              {quote.verification_ref ? (
                <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground">
                  <BookOpen className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span>Checked against: {quote.verification_ref}</span>
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              This line was written for REBIRTH. It is not a quotation and is not attributed to
              anyone.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHistoryOpen((value) => !value)}
            aria-expanded={historyOpen}
          >
            <ChevronDown
              className={cn('transition-transform duration-150', historyOpen && 'rotate-180')}
              aria-hidden="true"
            />
            Previous lines
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings#motivation">
              Tone and preferences
              <ExternalLink aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {historyOpen ? (
          <div className="rounded-md border border-border bg-muted/20 p-3">
            {history.loading ? <LoadingBlock rows={2} label="Loading previous lines" /> : null}

            {history.error ? (
              <div className="space-y-2">
                <p role="alert" className="text-xs leading-relaxed text-muted-foreground">
                  {history.error}
                </p>
                <Button variant="outline" size="sm" onClick={history.reload}>
                  Try again
                </Button>
              </div>
            ) : null}

            {!history.loading && !history.error && previous.length > 0 ? (
              <ul className="space-y-2.5">
                {previous.map((entry: QuoteDeliveryEntry) => (
                  <li key={`${entry.delivered_on}-${entry.quote.id}`} className="text-xs">
                    <p className="tabular-nums text-muted-foreground">{entry.delivered_on}</p>
                    <p className="mt-0.5 leading-relaxed text-foreground">{entry.quote.body}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {entry.quote.content_type === 'verified'
                        ? `${entry.quote.attribution ?? 'Unknown'}${
                            entry.quote.source_title ? ` — ${entry.quote.source_title}` : ''
                          }`
                        : 'Written for REBIRTH'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            {!history.loading && !history.error && previous.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                This is the first line you have been shown. Yesterday&rsquo;s will appear here
                tomorrow.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Rendered when the library has nothing, so the slot explains itself. */
export function QuoteUnavailable({ message }: { message: string | null }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-5 sm:p-6">
        <p className="font-serif text-lg leading-snug text-foreground">No line today</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {message ??
            'The quote library is empty, so nothing was shown rather than something invented.'}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The seed file adds the reference library. Nothing here is required for the rest of the app
          to work.
        </p>
      </CardContent>
    </Card>
  );
}
