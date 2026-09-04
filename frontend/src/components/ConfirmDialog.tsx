/**
 * Reusable confirmation dialog. Replaces native window.confirm() calls so
 * destructive actions get a themed, accessible prompt. Built on Modal, which
 * owns the behaviour (portal, Escape, focus trap + restore, scroll lock,
 * Back-button close) — this file owns only the confirm layout.
 */
import clsx from "clsx";
import Modal from "./Modal";
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
  return (
    <Modal open={open} onClose={onCancel} size="sm" layer="dialog" alert>
      <div className="flex items-start gap-3">
        {variant === "danger" && (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangleIcon className="h-5 w-5 text-red-400" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {description && (
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
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
    </Modal>
  );
}
