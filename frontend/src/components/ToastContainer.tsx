/**
 * Renders the stack of active toasts in the bottom-right corner.
 * Two shapes:
 *   • plain — one-line feedback (save confirmations, errors)
 * Positioned clear of the mobile bottom nav (45px tall + the device safe area);
 * on desktop there is no nav bar so it sits at the usual bottom-4.
 *
 *   • card  — a rich, app-styled card (title eyebrow + chip + body), used for
 *     actionable events like "New Driver Note". If onClick is set the whole
 *     card is tappable; the ✕ still dismisses without firing it.
 */
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { useToast, type Toast, type ToastVariant } from "../contexts/ToastContext";
import { CheckIcon, XIcon, AlertTriangleIcon } from "./icons";

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: string; eyebrow: string }> = {
  success: { border: "border-l-emerald-500", icon: "text-emerald-400", eyebrow: "text-emerald-400" },
  error: { border: "border-l-red-500", icon: "text-red-400", eyebrow: "text-red-400" },
  info: { border: "border-l-sky-500", icon: "text-sky-400", eyebrow: "text-sky-400" },
};

function VariantIcon({ variant }: { variant: ToastVariant }) {
  const cls = clsx("h-4 w-4 shrink-0", VARIANT_STYLES[variant].icon);
  if (variant === "success") return <CheckIcon className={cls} />;
  if (variant === "error") return <AlertTriangleIcon className={cls} />;
  return <AlertTriangleIcon className={cls} />;
}

/** Rich card toast — matches the app's card look (surface, hairline, ink). */
function CardToast({ t, dismiss }: { t: Toast; dismiss: (id: number) => void }) {
  const styles = VARIANT_STYLES[t.variant];
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className={clsx("text-[10px] font-bold uppercase tracking-[0.14em]", styles.eyebrow)}>
          {t.title}
        </span>
        {t.chip && (
          <span className="font-mono text-sm font-black tabular-nums leading-none text-ink">{t.chip}</span>
        )}
      </div>
      {t.message && (
        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-snug text-ink-soft">
          {t.message}
        </p>
      )}
      {t.onClick && (
        <p className="mt-1.5 text-[10px] font-semibold text-ink-faint">Tap to open →</p>
      )}
    </>
  );
  return (
    <div
      className={clsx(
        "pointer-events-auto relative overflow-hidden rounded-xl border border-hairline border-l-4 bg-surface shadow-xl",
        styles.border,
      )}
    >
      {t.onClick ? (
        <button
          type="button"
          onClick={() => { t.onClick?.(); dismiss(t.id); }}
          className="block w-full px-3 py-2.5 pr-8 text-left transition-colors hover:bg-surface-2"
        >
          {body}
        </button>
      ) : (
        <div className="px-3 py-2.5 pr-8">{body}</div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}
        className="absolute right-2 top-2.5 text-ink-faint transition-colors hover:text-ink-soft"
        aria-label="Dismiss"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 z-[100] flex max-h-[70svh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto overscroll-contain bottom-[calc(3.75rem+env(safe-area-inset-bottom))] md:bottom-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            role="status"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.2 }}
          >
            {t.title ? (
              <CardToast t={t} dismiss={dismiss} />
            ) : (
              <div
                className={clsx(
                  "pointer-events-auto flex items-start gap-2 rounded-lg border border-slate-800 border-l-4 bg-slate-900 px-3 py-2.5 shadow-lg",
                  VARIANT_STYLES[t.variant].border,
                )}
              >
                <VariantIcon variant={t.variant} />
                {t.onClick ? (
                  <button
                    type="button"
                    onClick={() => { t.onClick?.(); dismiss(t.id); }}
                    className="flex-1 text-left text-sm text-slate-200 underline decoration-slate-600 underline-offset-2 transition-colors hover:text-white hover:decoration-slate-300"
                  >
                    {t.message}
                  </button>
                ) : (
                  <p className="flex-1 text-sm text-slate-200">{t.message}</p>
                )}
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 text-slate-500 transition-colors hover:text-slate-300"
                  aria-label="Dismiss"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
