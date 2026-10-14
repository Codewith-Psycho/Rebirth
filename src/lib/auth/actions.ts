'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { getSupabaseEnv } from '@/lib/supabase/env';
import { getServerClient } from '@/lib/supabase/server';
import {
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from '@/lib/validation/schemas';
import { safeRedirectTarget, type AuthState } from './types';

/**
 * Authentication actions.
 *
 * Two things are deliberate:
 *
 *   · Sign-in and password-reset failures return the *same* message whether the
 *     address is unknown or the password is wrong. Distinguishing them turns the
 *     form into a way of discovering which addresses have accounts.
 *   · The post-auth redirect target is validated as a site-relative path, so a
 *     crafted `?next=https://elsewhere.example` cannot be used to bounce a
 *     freshly signed-in user off-site.
 */

const GENERIC_CREDENTIALS_MESSAGE = 'That email and password combination did not work.';
const UNEXPECTED_MESSAGE = 'Something went wrong on our side. Please try again.';
const UNCONFIGURED_MESSAGE =
  'This deployment is not connected to a database yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.';

function fieldErrorsOf(issues: Array<{ path: Array<string | number>; message: string }>) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/* ── Sign in ────────────────────────────────────────────────────────────── */

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Check the form below.', fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const supabase = await getServerClient();
  if (!supabase) return { status: 'error', message: UNCONFIGURED_MESSAGE };

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Unconfirmed addresses are the one case worth naming, because the fix is
    // in the user's inbox rather than in the form.
    if (/email not confirmed/i.test(error.message)) {
      return {
        status: 'error',
        message: 'That address has not been confirmed yet. Check your inbox for the confirmation link.',
      };
    }
    return { status: 'error', message: GENERIC_CREDENTIALS_MESSAGE };
  }

  revalidatePath('/', 'layout');
  redirect(safeRedirectTarget(formData.get('next')));
}

/* ── Sign up ────────────────────────────────────────────────────────────── */

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get('displayName'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
    timezone: formData.get('timezone') || 'UTC',
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Check the form below.', fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const supabase = await getServerClient();
  if (!supabase) return { status: 'error', message: UNCONFIGURED_MESSAGE };

  const env = getSupabaseEnv();
  const origin = env?.siteUrl ?? '';

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // The sign-up trigger reads these and writes the profile and preferences
      // rows, so the new account lands with the right name and local day
      // straight away rather than defaulting to UTC.
      data: { display_name: parsed.data.displayName, timezone: parsed.data.timezone },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
        safeRedirectTarget(formData.get('next')),
      )}`,
    },
  });

  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      // Deliberately *not* "that email is taken": this form should not be usable
      // to enumerate accounts. The copy points at the two things the person can
      // actually do.
      return {
        status: 'error',
        message:
          'We could not create that account. If you already have one, sign in instead, or reset your password.',
      };
    }
    return { status: 'error', message: UNEXPECTED_MESSAGE };
  }

  if (data.session) {
    revalidatePath('/', 'layout');
    redirect(safeRedirectTarget(formData.get('next')));
  }

  return {
    status: 'sent',
    message: `Almost there. We sent a confirmation link to ${parsed.data.email}. Open it and you will land straight in.`,
  };
}

/* ── Password reset ─────────────────────────────────────────────────────── */

export async function forgotPasswordAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });

  if (!parsed.success) {
    return { status: 'error', message: 'Check the form below.', fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const supabase = await getServerClient();
  if (!supabase) return { status: 'error', message: UNCONFIGURED_MESSAGE };

  const env = getSupabaseEnv();
  const origin = env?.siteUrl ?? '';

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/update-password')}`,
  });

  // Always the same answer, whether or not the address exists — otherwise this
  // form tells anyone who asks which emails have accounts.
  return {
    status: 'sent',
    message: 'If that address has an account, a reset link is on its way. Check your inbox in a minute.',
  };
}

export async function updatePasswordAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Check the form below.', fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const supabase = await getServerClient();
  if (!supabase) return { status: 'error', message: UNCONFIGURED_MESSAGE };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      status: 'error',
      message: 'That reset link has expired or was already used. Request a new one and try again.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: 'error', message: UNEXPECTED_MESSAGE };

  revalidatePath('/', 'layout');
  redirect('/today');
}

/* ── Sign out ───────────────────────────────────────────────────────────── */

export async function signOutAction(): Promise<void> {
  const supabase = await getServerClient();
  if (supabase) await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  redirect('/login');
}
