import { useRouteError, isRouteErrorResponse, useNavigate } from "react-router-dom";

/**
 * Route-level error boundary — shown when a loader, action, or child component
 * throws. Handles both React Router route errors and generic JS errors.
 */
export default function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  let title = "Something went wrong";
  let message = "An unexpected error occurred.";
  let status: number | null = null;
  let emoji = "💥";

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (error.status === 404) {
      title = "Page not found";
      message = "The page you're looking for doesn't exist or was moved.";
      emoji = "🗺️";
    } else if (error.status === 403) {
      title = "Access denied";
      message = "You don't have permission to view this page.";
      emoji = "🔒";
    } else {
      title = `Error ${error.status}`;
      message = error.statusText || message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 p-6 text-center">
      {/* Ambient glow blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-violet-600/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-1/4 h-72 w-72 rounded-full bg-red-600/8 blur-3xl"
      />

      {/* Card */}
      <div className="relative z-10 flex max-w-md flex-col items-center gap-6 rounded-2xl border border-slate-800 bg-slate-900/80 px-8 py-10 shadow-2xl backdrop-blur-sm">
        {/* Icon */}
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-4xl shadow-inner">
          {emoji}
        </div>

        {/* Status code */}
        {status && (
          <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-0.5 text-xs font-mono font-semibold tracking-widest text-slate-400 uppercase">
            HTTP {status}
          </span>
        )}

        {/* Text */}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">{title}</h1>
          <p className="text-sm leading-relaxed text-slate-400">{message}</p>
        </div>

        {/* Divider */}
        <div className="w-full border-t border-slate-800" />

        {/* Actions */}
        <div className="flex gap-3">
          <button
            className="btn-ghost text-sm"
            onClick={() => navigate(-1)}
          >
            ← Go back
          </button>
          <button
            className="btn-primary text-sm"
            onClick={() => navigate("/", { replace: true })}
          >
            Home
          </button>
        </div>
      </div>

      {/* Bottom wordmark */}
      <p className="relative z-10 mt-8 text-xs text-slate-700 select-none">
        ReadyRoute V2
      </p>
    </div>
  );
}
