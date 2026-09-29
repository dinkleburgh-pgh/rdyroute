/**
 * Whether the floor sees load TIMING — the running clock, pace bar, "over"
 * warnings, averages and per-truck load durations.
 *
 * Operations → Workflows → "Load timer". Hiding it is purely presentational:
 * every load is still stamped (load_start_time / load_finish_time /
 * load_duration_seconds) and recorded to the pace history exactly as before,
 * so Report → Load times and Trends keep every number. The switch exists
 * because a clock counting up over the crew's shoulder is pressure the dock
 * doesn't need while it is short-staffed.
 *
 * Until settings have loaded this reports HIDDEN: a timer that flashes up and
 * then disappears is the one outcome the switch is meant to prevent, while a
 * timer that appears a moment late costs nothing. The key is on the server's
 * user-readable allowlist so floor roles actually receive it, and App.tsx's
 * settings poller carries a change to screens that are already open.
 */
import { useSettings } from "../api/hooks";

export const LOAD_TIMER_SETTING = "load_timer_visible";

export function useLoadTimerVisible(): boolean {
  const { data: settings } = useSettings();
  if (!settings) return false;
  return settings.find((s) => s.key === LOAD_TIMER_SETTING)?.value !== false;
}
