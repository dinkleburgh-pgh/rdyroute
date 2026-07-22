/**
 * Reusable confirmation dialog. Replaces native window.confirm() calls so
 * destructive actions get a themed, accessible prompt.
 *
 * Controlled via the `open` prop. Renders a centered modal over a backdrop.
 */
import clsx from "clsx";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangleIcon } from "./icons";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional middle action rendered between Cancel and Confirm. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  variant?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  secondaryLabel,
  onSecondary,
  variant = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  // Portal to <body>: a transformed ancestor (framer page wrappers) otherwise
  // turns position:fixed into container-relative positioning, centering the
  // dialog on the PAGE instead of the device viewport — off-screen buttons on
  // mobile. The panel is clamped to the visible height so actions always stay
  // reachable.
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90svh] w-full max-w-sm overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {variant === "danger" && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangleIcon className="h-5 w-5 text-red-400" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-100">{title}</h3>
            {description && (
              <p className="mt-1 text-sm text-slate-400">{description}</p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button className="btn-primary" onClick={onSecondary} disabled={busy}>
              {secondaryLabel}
            </button>
          )}
          <button
            className={clsx(variant === "danger" ? "btn-danger" : "btn-primary")}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
