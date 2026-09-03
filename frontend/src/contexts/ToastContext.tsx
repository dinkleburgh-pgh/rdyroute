/**
 * Lightweight toast notification system. No external dependencies.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success("Saved");
 *   toast.error("Something went wrong");
 *   toast.info("Heads up");
 *
 * Render <ToastContainer /> once near the app root (already done in App.tsx).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setToastEmitter } from "../utils/toastBridge";

export type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  /** Makes the toast clickable — fires, then dismisses. */
  onClick?: () => void;
  /** Override the auto-dismiss delay (ms). Actionable toasts want longer.
   *  Pass 0 (or negative) to make the toast STICKY — it stays until the user
   *  dismisses it with the X. Used for alerts that must be acknowledged. */
  durationMs?: number;
  /** Renders the toast as a rich card: this eyebrow title over the message. */
  title?: string;
  /** Small mono chip beside the title — e.g. a truck number ("#57"). */
  chip?: string;
  /**
   * The Pop-ups settings row this toast is governed by. When set, the card
   * grows a small gear that jumps to Management → Pop-ups with that row
   * highlighted, so "how do I turn this off / make it stay longer" is one tap
   * from the thing itself rather than a hunt through Settings.
   */
  settingsKind?: string;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  onClick?: () => void;
  settingsKind?: string;
  title?: string;
  chip?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (message: string, variant: ToastVariant, opts?: ToastOptions) => void;
  dismiss: (id: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 3500;
let _nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant, opts?: ToastOptions) => {
      const id = _nextId++;
      setToasts((prev) => [
        ...prev,
        { id, message, variant, onClick: opts?.onClick, title: opts?.title, chip: opts?.chip, settingsKind: opts?.settingsKind },
      ]);
      const ttl = opts?.durationMs ?? AUTO_DISMISS_MS;
      if (ttl > 0) setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  // Registers the non-React bridge (utils/toastBridge) so modules outside the
  // tree — the query client's global onError — can raise toasts too.
  useEffect(() => {
    setToastEmitter(push);
    return () => setToastEmitter(null);
  }, [push]);

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      push,
      dismiss,
      success: (m) => push(m, "success"),
      error: (m) => push(m, "error"),
      info: (m, o) => push(m, "info", o),
    }),
    [toasts, push, dismiss],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
