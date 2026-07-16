import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { useMessages, useSendMessage, useDeleteMessage } from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";
import PageHeader from "../components/PageHeader";

import { format, parseISO } from "date-fns";

const CHANNELS = ["Team"];

const ROLE_COLORS: Record<string, string> = {
  admin:      "#ef4444",
  fleet:      "#06b6d4",
  lead:       "#a855f7",
  atl:        "#f97316",
  supervisor: "#a855f7",
  loader:     "#22c55e",
  unloader:   "#14b8a6",
  guest:      "#64748b",
};

const ADMIN_ROLES = new Set(["admin", "fleet", "atl", "lead", "supervisor"]);

const DISPLAY_OVERRIDE: Record<string, { label: string; color: string }> = {
  nate: { label: "lead", color: "#a855f7" },
};

function RoleBadge({ role, username }: { role?: string | null; username?: string }) {
  if (!role) return null;
  const override = username ? DISPLAY_OVERRIDE[username] : undefined;
  const label = override ? override.label : role;
  const color = override ? override.color : (ROLE_COLORS[role] ?? ROLE_COLORS.guest);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 8px",
        borderRadius: "999px",
        fontSize: "9.5px",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: color + "1a",
        border: `1px solid ${color}33`,
        color: color,
      }}
    >
      {label}
    </span>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="shrink-0 rounded p-1 text-ink-faint hover:bg-surface-2 hover:text-red-400 transition-colors"
      onClick={onClick}
      title="Delete message"
    >
      <div className="h-3.5 w-3.5 rounded-full bg-current" />
    </button>
  );
}

function dayLabel(iso: string) {
  const d = parseISO(iso);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return format(d, "EEEE, MMM d");
}

function timeStr(iso: string) {
  return format(parseISO(iso), "h:mm a");
}

export default function Communications() {
  const { user } = useAuth();
  const [channel, setChannel] = useState("Team");
  const [text, setText] = useState("");
  const { data, isLoading } = useMessages(channel);
  const send = useSendMessage();
  const deleteMsg = useDeleteMessage();
  const listRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const isAdmin = ADMIN_ROLES.has(user?.role ?? "");

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [data?.length]);

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || !user) return;
    await send.mutateAsync({
      channel,
      username: user.username,
      sender_role: user.role,
      message: text.trim(),
    });
    setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSend(e as unknown as FormEvent);
    }
  }

  const messages = data ?? [];

  // Group by day for date separators
  const grouped: { day: string; msgs: typeof messages }[] = [];
  for (const m of messages) {
    const d = dayLabel(m.sent_at);
    if (!grouped.length || grouped[grouped.length - 1].day !== d) {
      grouped.push({ day: d, msgs: [m] });
    } else {
      grouped[grouped.length - 1].msgs.push(m);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <PageHeader
        eyebrow="Team"
        title="Communications"
        subtitle="Share shift updates, keep the team aligned, and track channel conversations."
        className="shrink-0"
      />

      {/* Channel tabs */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline bg-[#0b0f17] px-3 py-2">
        {CHANNELS.map((c) => (
          <button
            key={c}
            onClick={() => setChannel(c)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              channel === c
                ? "text-[#7cc4ff]"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink-soft"
            }`}
            style={
              channel === c
                ? { background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.22)" }
                : { border: "1px solid transparent" }
            }
          >
            #{c}
          </button>
        ))}
      </div>

      {/* Message list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-[26px] py-[18px]">
        {isLoading && (
          <p className="py-10 text-center text-sm text-ink-faint">Loading…</p>
        )}
        {!isLoading && messages.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-faint">
            No messages in #{channel} yet.
          </p>
        )}

        {grouped.map(({ day, msgs }) => (
          <div key={day}>
            {/* Day separator */}
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
              <span className="shrink-0 text-[11.5px] font-medium text-ink-faint">{day}</span>
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
            </div>

            {msgs.map((m, idx) => {
              const isMe = m.username === user?.username;
              const canDelete = !m.is_deleted && (isAdmin || m.username === user?.username);
              // Consecutive run detection — hide name/role/time on follow-up messages
              const isContinuation =
                idx > 0 &&
                msgs[idx - 1].username === m.username &&
                !msgs[idx - 1].is_deleted &&
                !m.is_deleted;

              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.02 }}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${
                    isContinuation ? "mb-0.5 mt-0.5" : "mb-3"
                  }`}
                  onMouseEnter={() => setHoveredId(m.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Metadata header — only on first message in a run */}
                  {!isContinuation && (
                    <div className={`mb-1 flex items-center gap-1.5 ${isMe ? "flex-row-reverse" : ""}`}>
                      <span className={`text-[13.5px] font-semibold leading-none ${isMe ? "text-[#7cc4ff]" : "text-ink"}`}>
                        {m.username}
                      </span>
                      <RoleBadge role={m.sender_role} username={m.username} />
                      <span className="text-[10px] text-ink-faint leading-none">
                        {timeStr(m.sent_at)}
                      </span>
                      {canDelete && hoveredId === m.id && (
                        <DeleteButton
                          onClick={() => deleteMsg.mutate({ id: m.id, username: user!.username, role: user!.role })}
                        />
                      )}
                    </div>
                  )}

                  {/* Bubble row */}
                  <div className={`flex items-center gap-1.5 max-w-[80%] ${isMe ? "flex-row-reverse" : ""}`}>
                    <div
                      className={[
                        "rounded-2xl px-3.5 py-2 text-base leading-relaxed break-words",
                        !isContinuation && isMe  ? "rounded-tr-sm" : "",
                        !isContinuation && !isMe ? "rounded-tl-sm" : "",
                      ].filter(Boolean).join(" ")}
                      style={
                        m.is_deleted
                          ? { background: "rgba(255,255,255,0.03)", fontStyle: "italic", color: "#7a8698" }
                          : isMe
                          ? { background: "#2563eb", color: "#fff" }
                          : { background: "#1d2636", border: "1px solid rgba(255,255,255,0.08)", color: "#cdd6e2" }
                      }
                    >
                      {m.is_deleted ? "[deleted]" : m.message}
                    </div>

                    {/* Delete on hover for continuation messages (no metadata line) */}
                    {canDelete && isContinuation && hoveredId === m.id && (
                      <DeleteButton
                        onClick={() => deleteMsg.mutate({ id: m.id, username: user!.username, role: user!.role })}
                      />
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="relative z-10 shrink-0 border-t border-hairline bg-[#0b0f17] px-[26px] py-[14px]">
        <form onSubmit={onSend} className="flex items-end gap-2">
          <textarea
            rows={1}
            placeholder={`Message #${channel}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              resize: "none",
              maxHeight: "8rem",
              overflowY: "auto",
              background: "#1d2636",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px",
              fontSize: "14px",
              color: "#cdd6e2",
              padding: "10px 14px",
              lineHeight: "1.5",
              outline: "none",
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
          />
          <button
            type="submit"
            disabled={send.isPending || !text.trim()}
            style={{
              flexShrink: 0,
              background: "linear-gradient(135deg,#3b82f6,#2563eb)",
              color: "#fff",
              borderRadius: "12px",
              padding: "11px 22px",
              fontSize: "14px",
              fontWeight: 600,
              border: "none",
              cursor: send.isPending || !text.trim() ? "not-allowed" : "pointer",
              opacity: send.isPending || !text.trim() ? 0.5 : 1,
              transition: "opacity 0.15s",
            }}
          >
            Send
          </button>
        </form>
        <p className="mt-1.5 font-mono text-[10px] text-ink-faint">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
