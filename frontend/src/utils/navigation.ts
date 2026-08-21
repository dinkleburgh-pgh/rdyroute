/**
 * App navigation for components that live OUTSIDE the router.
 *
 * ToastContainer is mounted as a sibling of <RouterProvider> (App.tsx) so
 * toasts survive route changes — which means it has no router context and
 * `useNavigate()` there throws "may be used only in the context of a <Router>",
 * taking the whole toast down with it. Layout, which IS inside the router,
 * registers its navigate function here and the toast borrows it.
 */
type NavFn = (to: string) => void;

let appNavigate: NavFn | null = null;

export function setAppNavigator(fn: NavFn | null) {
  appNavigate = fn;
}

/** SPA-navigate when the router is mounted; fall back to a full load if not. */
export function navigateApp(to: string) {
  if (appNavigate) appNavigate(to);
  else window.location.assign(to);
}
