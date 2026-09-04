/**
 * The one modal primitive. ~29 hand-rolled `fixed inset-0` overlays grew up
 * across the app — ten visual patterns, four backdrop opacities, four kinds of
 * close affordance, almost none with Escape, none with a focus trap, none
 * closing on the phone's Back button. This owns all of that behaviour once:
 *
 *   - portal to <body> (a transformed ancestor otherwise re-anchors fixed)
 *   - one backdrop (black/60), sizes sm/md/lg, layer from utils/z
 *   - Escape closes; Tab cycles inside; focus returns to the opener on close
 *   - body scroll locks while any modal is open (ref-counted)
 *   - (Back-button close is deferred: raw pushState fights the router's own
 *     history handling — it lands router-integrated in a later phase)
 *   - `sheet` docks to the bottom edge on phones with the safe-area inset
 *     (the FleetMobileActionSheet treatment), centred dialog from sm: up
 *
 * Content stays the caller's: pass a `title` for the standard header (with the
 * lucide ✕), or render your own header inside and skip it.
 */
import clsx from "clsx";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Z, type ZLayer } from "../utils/z";

const SIZES = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl" } as const;

let scrollLocks = 0;
function lockScroll() {
  if (scrollLocks++ === 0) document.body.style.overflow = "hidden";
}
function unlockScroll() {
  if (--scrollLocks <= 0) {
    scrollLocks = 0;
    document.body.style.overflow = "";
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  open,
  onClose,
  title,
  size = "md",
  layer = "overlay",
  sheet = false,
  alert = false,
  panelClassName,
  bodyClassName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Standard header with this title and a ✕. Omit to own the header yourself. */
  title?: ReactNode;
  size?: keyof typeof SIZES;
  layer?: ZLayer;
  /** Bottom-sheet on phones (full width, docked, safe-area padded). */
  sheet?: boolean;
  /** role="alertdialog" for confirms. */
  alert?: boolean;
  panelClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    lockScroll();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);

    // Initial focus: the panel itself, so Escape/Tab work immediately without
    // stealing focus from a field the caller autofocuses.
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    }, 0);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.clearTimeout(t);
      unlockScroll();
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 flex justify-center bg-black/60",
        sheet ? "items-end sm:items-center sm:p-4" : "items-center p-4",
      )}
      style={{ zIndex: Z[layer] }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        tabIndex={-1}
        className={clsx(
          "w-full overflow-y-auto border border-hairline bg-surface shadow-xl outline-none",
          SIZES[size],
          sheet
            ? "max-h-[92svh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] sm:max-h-[90svh] sm:rounded-2xl sm:pb-0"
            : "max-h-[90svh] rounded-xl",
          panelClassName,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <h3 className="min-w-0 text-base font-bold text-ink">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className={bodyClassName ?? "p-5"}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
