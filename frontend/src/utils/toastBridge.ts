/**
 * Non-React bridge into the toast system, for modules that run outside the
 * component tree (the query client's global mutation onError). Same pattern as
 * utils/navigation.ts. ToastProvider registers itself on mount; until then
 * emits are dropped silently (nothing user-facing can fail before the
 * provider exists).
 */
import type { ToastOptions, ToastVariant } from "../contexts/ToastContext";

type Emitter = (message: string, variant: ToastVariant, opts?: ToastOptions) => void;

let emitter: Emitter | null = null;

export function setToastEmitter(fn: Emitter | null) {
  emitter = fn;
}

export function emitToast(message: string, variant: ToastVariant, opts?: ToastOptions) {
  emitter?.(message, variant, opts);
}
