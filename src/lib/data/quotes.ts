import type { DayKey } from '@/lib/domain/time';
import type { DailyQuoteResult, Tables } from '@/lib/types/database';
import { fail, fromPostgrest, ok, type Result } from './result';
import type { Db } from './types';

/**
 * Motivation.
 *
 * Every line in the library declares what it is. A `verified` row carries a
 * character, a series, a translation note and a reference to where it was
 * checked; an `original` row is a line written for REBIRTH and carries no
 * attribution. The database enforces both directions
 * (`quote_library_verified_has_source`, `quote_library_original_unattributed`),
 * so an unsourced quotation cannot be stored as verified and an original line
 * cannot be dressed up as somebody's words.
 *
 * Nothing here calls an external service. The library is seeded reference
 * content in the database, so the feature works offline and without a paid API.
 */

export type Quote = Tables<'quote_library'>;
export type QuoteDelivery = Tables<'daily_quote_deliveries'>;

/**
 * Today's line.
 *
 * The choice is deterministic and *persisted*: the same user sees the same
 * quote on every device and after every refresh, and "previous quotes" has a
 * real record to read rather than a re-rolled random pick.
 */
export async function dailyQuote(db: Db, day: DayKey): Promise<Result<DailyQuoteResult>> {
  const { data, error } = await db.rpc('rpc_daily_quote', { p_date: day });
  if (error) return fromPostgrest(error, 'We could not load today’s line.');
  const first = (data ?? [])[0];
  if (!first) return fail('There is no active quote in the library yet. Run the seed file to load one.');
  return ok(first);
}

export async function listRecentDeliveries(
  db: Db,
  limit = 14,
): Promise<Result<Array<{ delivered_on: DayKey; quote: Quote }>>> {
  const { data: deliveries, error } = await db
    .from('daily_quote_deliveries')
    .select('*')
    .order('delivered_on', { ascending: false })
    .limit(limit);

  if (error) return fromPostgrest(error, 'We could not load your previous lines.');
  if (!deliveries || deliveries.length === 0) return ok([]);

  const { data: quotes, error: quotesError } = await db
    .from('quote_library')
    .select('*')
    .in(
      'id',
      deliveries.map((row) => row.quote_id),
    );

  if (quotesError) return fromPostgrest(quotesError, 'We could not load your previous lines.');

  const byId = new Map((quotes ?? []).map((quote) => [quote.id, quote]));
  const out: Array<{ delivered_on: DayKey; quote: Quote }> = [];
  for (const delivery of deliveries) {
    const quote = byId.get(delivery.quote_id);
    if (quote) out.push({ delivered_on: delivery.delivered_on, quote });
  }
  return ok(out);
}

export async function listFavoriteQuotes(db: Db): Promise<Result<Quote[]>> {
  const { data: favorites, error } = await db
    .from('user_favorite_quotes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return fromPostgrest(error, 'We could not load your saved lines.');
  if (!favorites || favorites.length === 0) return ok([]);

  const { data: quotes, error: quotesError } = await db
    .from('quote_library')
    .select('*')
    .in(
      'id',
      favorites.map((row) => row.quote_id),
    );

  if (quotesError) return fromPostgrest(quotesError, 'We could not load your saved lines.');
  return ok(quotes ?? []);
}

/** The whole active library — small by design, and it drives the theme filter. */
export async function listActiveQuotes(db: Db): Promise<Result<Quote[]>> {
  const { data, error } = await db.from('quote_library').select('*').eq('is_active', true);

  if (error) return fromPostgrest(error, 'We could not load the quote library.');
  return ok(data ?? []);
}

export async function setQuoteFavorite(
  db: Db,
  userId: string,
  quoteId: string,
  favorite: boolean,
): Promise<Result<null>> {
  if (favorite) {
    const { error } = await db
      .from('user_favorite_quotes')
      .upsert({ user_id: userId, quote_id: quoteId }, { onConflict: 'user_id,quote_id' });
    if (error) return fromPostgrest(error, 'That line was not saved.');
    return ok(null);
  }

  const { error } = await db
    .from('user_favorite_quotes')
    .delete()
    .eq('user_id', userId)
    .eq('quote_id', quoteId);
  if (error) return fromPostgrest(error, 'That line was not removed.');
  return ok(null);
}

/** Tone labels present in the library, for the settings filter. */
export function availableTones(quotes: Quote[]): string[] {
  const tones = new Set<string>();
  for (const quote of quotes) {
    for (const tone of quote.tones ?? []) tones.add(tone);
  }
  return [...tones].sort();
}
