/**
 * Renders the stack of active toasts in the bottom-right corner.
 * Matches the app's dark theme (slate-900 surface, status-colored accent).
 */
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { useToast, type ToastVariant } from "../contexts/ToastContext";
import { CheckIcon, XIcon, AlertTriangleIcon } from "./icons";

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: string }> = {
  success: { border: "border-l-emerald-500", icon: "text-emerald-400" },
  error: { border: "border-l-red-500", icon: "text-red-400" },
  info: { border: "border-l-blue-500", icon: "text-blue-400" },
};

function VariantIcon({ variant }: { variant: ToastVariant }) {
  const cls = clsx("h-4 w-4 shrink-0", VARIANT_STYLES[variant].icon);
  if (variant === "success") return <CheckIcon className={cls} />;
  if (variant === "error") return <AlertTriangleIcon className={cls} />;
  return <AlertTriangleIcon className={cls} />;
}

export default function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            role="status"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.2 }}
            className={clsx(
              "pointer-events-auto flex items-start gap-2 rounded-lg border border-slate-800 border-l-4 bg-slate-900 px-3 py-2.5 shadow-lg",
              VARIANT_STYLES[t.variant].border,
            )}
          >
            <VariantIcon variant={t.variant} />
            <p className="flex-1 text-sm text-slate-200">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-slate-500 transition-colors hover:text-slate-300"
              aria-label="Dismiss"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
