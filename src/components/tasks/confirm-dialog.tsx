'use client';

import { useEffect, useState, type ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { Result } from '@/lib/data/result';

/**
 * A confirmation that reports what actually happened.
 *
 * It runs the action itself rather than trusting the caller's promise that the
 * action succeeded, so a refused write keeps the dialog open with the database's
 * own message instead of closing on a lie.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  onConfirm: () => Promise<Result<unknown>>;
  onConfirmed?: () => void;
  /** Rendered between the description and the footer, for scope choices etc. */
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmIcon,
  onConfirm,
  onConfirmed,
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
  }, [open]);

  async function run() {
    setBusy(true);
    setError(null);
    const result = await onConfirm();
    setBusy(false);
    if (result.ok) {
      onOpenChange(false);
      onConfirmed?.();
    } else {
      setError(result.error);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>

        {children}

        {error ? (
          <p role="alert" className="text-sm leading-relaxed text-muted-foreground">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={() => void run()} loading={busy}>
            {confirmIcon}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
