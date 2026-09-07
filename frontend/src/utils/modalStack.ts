/**
 * Registry of open modals, so ONE router blocker (in Layout) can turn the
 * phone's Back button into "close the top modal" instead of leaving the page.
 * Modal registers on open; the last-registered close wins. Kept outside React
 * so StrictMode's double-mount can't race it.
 */
type CloseFn = () => void;
const stack: CloseFn[] = [];

export function registerOpenModal(close: CloseFn): () => void {
  stack.push(close);
  return () => {
    const i = stack.indexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function hasOpenModal(): boolean {
  return stack.length > 0;
}

export function closeTopModal(): void {
  stack[stack.length - 1]?.();
}

// Dev-only visibility for automated verification.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __rrModalStack: () => number }).__rrModalStack = () => stack.length;
}
