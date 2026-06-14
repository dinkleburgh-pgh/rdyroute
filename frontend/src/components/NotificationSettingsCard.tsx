import { Bell, BellOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchNotificationPublicKey,
  useNotificationStatus,
  useSubscribeNotifications,
  useUnsubscribeNotifications,
} from "../api/hooks";
import { useToast } from "../contexts/ToastContext";
import type { NotificationEvent } from "../types";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }
  return output;
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

type LocalState = {
  endpoint: string | null;
  permission: NotificationPermission;
  supported: boolean;
};

async function getPushRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("Service worker is not ready.")), 3_000);
    }),
  ]);
}

export default function NotificationSettingsCard() {
  const toast = useToast();
  const { data: status, isLoading } = useNotificationStatus(true);
  const subscribe = useSubscribeNotifications();
  const unsubscribe = useUnsubscribeNotifications();
  const seenTagsRef = useRef<Map<string, number>>(new Map());
  const [localState, setLocalState] = useState<LocalState>({
    endpoint: null,
    permission: typeof Notification === "undefined" ? "default" : Notification.permission,
    supported: isPushSupported(),
  });

  useEffect(() => {
    if (!localState.supported) return;
    let cancelled = false;
    getPushRegistration()
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (cancelled) return;
        setLocalState((current) => ({
          ...current,
          endpoint: subscription?.endpoint ?? null,
          permission: Notification.permission,
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setLocalState((current) => ({ ...current, endpoint: null, permission: Notification.permission }));
      });
    return () => {
      cancelled = true;
    };
  }, [localState.supported]);

  useEffect(() => {
    if (!localState.endpoint) return;
    const onNotification = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<NotificationEvent>;
      const notification = event.detail;
      const seenAt = seenTagsRef.current.get(notification.tag);
      const now = Date.now();
      if (seenAt && now - seenAt < 10_000) return;
      seenTagsRef.current.set(notification.tag, now);
      toast.info(`${notification.title}: ${notification.body}`);
    };
    window.addEventListener("readyroute:notification", onNotification as EventListener);
    return () => {
      window.removeEventListener("readyroute:notification", onNotification as EventListener);
    };
  }, [localState.endpoint, toast]);

  const statusLabel = useMemo(() => {
    if (!localState.supported) return "Unsupported";
    if (isLoading) return "Checking";
    if (!status?.configured) return "Unavailable";
    if (localState.permission === "denied") return "Blocked";
    if (localState.endpoint) return "Enabled";
    return "Disabled";
  }, [isLoading, localState.endpoint, localState.permission, localState.supported, status?.configured]);

  const statusTone = localState.endpoint
    ? "text-emerald-300 border-emerald-700/50 bg-emerald-950/30"
    : localState.permission === "denied"
      ? "text-amber-300 border-amber-700/50 bg-amber-950/30"
      : "text-slate-300 border-slate-700 bg-slate-900/60";

  async function refreshSubscriptionState() {
    if (!localState.supported) return;
    const registration = await getPushRegistration();
    const subscription = await registration.pushManager.getSubscription();
    setLocalState((current) => ({
      ...current,
      endpoint: subscription?.endpoint ?? null,
      permission: Notification.permission,
    }));
    return subscription;
  }

  async function enableNotifications() {
    if (!localState.supported) {
      toast.error("Push notifications require HTTPS and a supported browser.");
      return;
    }
    const permission = await Notification.requestPermission();
    setLocalState((current) => ({ ...current, permission }));
    if (permission !== "granted") {
      toast.error("Browser notification permission was not granted.");
      return;
    }
    const keyData = await fetchNotificationPublicKey();
    if (!keyData.configured || !keyData.public_key) {
      toast.error("Push notifications are not configured on the server.");
      return;
    }
    let registration;
    try {
      registration = await getPushRegistration();
    } catch {
      toast.error("The app service worker is not active on this page yet.");
      return;
    }
    const existing = await registration.pushManager.getSubscription();
    const applicationServerKey = urlBase64ToUint8Array(keyData.public_key) as unknown as BufferSource;
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      }));
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      toast.error("The browser returned an incomplete push subscription.");
      return;
    }
    await subscribe.mutateAsync({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      device_label: navigator.platform || null,
      user_agent: navigator.userAgent,
    });
    await refreshSubscriptionState();
    toast.success("Push notifications enabled for this device.");
  }

  async function disableNotifications() {
    if (!localState.supported) return;
    let subscription: PushSubscription | null = null;
    try {
      const registration = await getPushRegistration();
      subscription = await registration.pushManager.getSubscription();
    } catch {
      subscription = null;
    }
    if (subscription?.endpoint) {
      await unsubscribe.mutateAsync({ endpoint: subscription.endpoint });
      await subscription.unsubscribe().catch(() => undefined);
    }
    await refreshSubscriptionState();
    toast.info("Push notifications disabled for this device.");
  }

  return (
    <div className="rounded-md bg-slate-950/60 px-3 py-2 text-left text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>
          {statusLabel}
        </span>
        {localState.endpoint ? (
          <button
            type="button"
            onClick={() => void disableNotifications()}
            disabled={unsubscribe.isPending}
            aria-label="Turn off notifications"
            className="flex items-center justify-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-60"
          >
            <BellOff className="h-3.5 w-3.5" />
            Turn off
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enableNotifications()}
            disabled={!localState.supported || !status?.configured || subscribe.isPending}
            aria-label="Turn on notifications"
            className="flex items-center justify-center gap-1 rounded-md border border-blue-700/60 bg-blue-950/40 px-3 py-2 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-950/60 disabled:opacity-60"
          >
            <Bell className="h-3.5 w-3.5" />
            Turn on
          </button>
        )}
      </div>
    </div>
  );
}
