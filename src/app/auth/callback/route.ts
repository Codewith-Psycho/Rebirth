import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { safeRedirectTarget } from '@/lib/auth/types';
import { getServerClient } from '@/lib/supabase/server';

/**
 * Where Supabase sends people back to.
 *
 * Handles both link shapes:
 *   · `?code=…`               — the PKCE flow used by the browser client
 *   · `?token_hash=…&type=…`  — the email links (confirmation, recovery, invite)
 *
 * On failure it returns to the sign-in page with a short code rather than a raw
 * error string, so nothing from the provider leaks into the URL. Recovery links
 * land on `/update-password` instead of the dashboard, because being signed in
 * with a password you have forgotten is not the same as being done.
 */

const OTP_TYPES: ReadonlySet<string> = new Set([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = safeRedirectTarget(url.searchParams.get('next'), '/today');

  const supabase = await getServerClient();
  if (!supabase) {
    return NextResponse.redirect(new URL('/login?error=unconfigured', url.origin));
  }

  let failed = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = error !== null;
  } else if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    failed = error !== null;
  } else {
    failed = true;
  }

  if (failed) {
    return NextResponse.redirect(new URL('/login?error=link', url.origin));
  }

  // A recovery link is for setting a password, not for browsing.
  if (type === 'recovery') {
    return NextResponse.redirect(new URL('/update-password', url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
