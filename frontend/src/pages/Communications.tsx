import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import { useMessages, useSendMessage, useDeleteMessage } from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";

const CHANNELS = ["Team"];

const ROLE_STYLE: Record<string, string> = {
  admin:      "bg-red-950 text-red-300 ring-1 ring-red-700/50",
  fleet:      "bg-cyan-950 text-cyan-300 ring-1 ring-cyan-700/50",
  lead:       "bg-blue-950 text-blue-300 ring-1 ring-blue-700/50",
  atl:        "bg-orange-950 text-orange-300 ring-1 ring-orange-700/50",
  supervisor: "bg-purple-950 text-purple-300 ring-1 ring-purple-700/50",
  loader:     "bg-green-950 text-green-300 ring-1 ring-green-700/50",
  unloader:   "bg-teal-950 text-teal-300 ring-1 ring-teal-700/50",
  guest:      "bg-slate-800 text-slate-400 ring-1 ring-slate-600/50",
};

const ADMIN_ROLES = new Set(["admin", "fleet", "atl", "lead", "supervisor"]);

const DISPLAY_OVERRIDE: Record<string, { label: string; cls: string }> = {
  nate: { label: "lead", cls: "bg-purple-950 text-purple-300 ring-1 ring-purple-700/50" },
};

function RoleBadge({ role, username }: { role?: string | null; username?: string }) {
  if (!role) return null;
  const override = username ? DISPLAY_OVERRIDE[username] : undefined;
  const label = override ? override.label : role;
  const cls = override ? override.cls : ROLE_STYLE[role] ?? ROLE_STYLE.guest;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {label}
    </span>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="shrink-0 rounded p-1 text-slate-600 hover:bg-slate-800 hover:text-red-400 transition-colors"
      onClick={onClick}
      title="Delete message"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
        <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
      </svg>
    </button>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-3">
        <h2 className="text-lg font-semibold text-white">Communications</h2>
      </div>

      {/* Channel tabs */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-800 bg-slate-950 px-3 py-2">
        {CHANNELS.map((c) => (
          <button
            key={c}
            onClick={() => setChannel(c)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              channel === c
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            #{c}
          </button>
        ))}
      </div>

      {/* Message list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-5">
        {isLoading && (
          <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
        )}
        {!isLoading && messages.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">
            No messages in #{channel} yet.
          </p>
        )}

        {grouped.map(({ day, msgs }) => (
          <div key={day}>
            {/* Day separator */}
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-800" />
              <span className="shrink-0 text-xs font-medium text-slate-500">{day}</span>
              <div className="h-px flex-1 bg-slate-800" />
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
                <div
                  key={m.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${
                    isContinuation ? "mb-0.5 mt-0.5" : "mb-3"
                  }`}
                  onMouseEnter={() => setHoveredId(m.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Metadata header — only on first message in a run */}
                  {!isContinuation && (
                    <div className={`mb-1 flex items-center gap-1.5 ${isMe ? "flex-row-reverse" : ""}`}>
                      <span className={`text-sm font-semibold leading-none ${isMe ? "text-blue-300" : "text-slate-200"}`}>
                        {m.username}
                      </span>
                      <RoleBadge role={m.sender_role} username={m.username} />
                      <span className="text-[10px] text-slate-500 leading-none">
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
                        // Pointed corner on the header side for first-in-run messages
                        !isContinuation && isMe  ? "rounded-tr-sm" : "",
                        !isContinuation && !isMe ? "rounded-tl-sm" : "",
                        m.is_deleted
                          ? "bg-slate-800/50 italic text-slate-500"
                          : isMe
                          ? "bg-blue-600 text-white"
                          : "bg-slate-800 text-slate-100",
                      ].filter(Boolean).join(" ")}
                      style={{ wordBreak: "break-word" }}
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
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="relative z-50 shrink-0 border-t border-slate-800 bg-slate-950 px-3 py-3 md:px-5">
        <form onSubmit={onSend} className="flex items-end gap-2">
          <textarea
            className="input flex-1 resize-none leading-relaxed"
            rows={1}
            placeholder={`Message #${channel}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ maxHeight: "8rem", overflowY: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
          />
          <button
            className="btn-primary shrink-0"
            type="submit"
            disabled={send.isPending || !text.trim()}
          >
            Send
          </button>
        </form>
        <p className="mt-1.5 text-[10px] text-slate-600">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}


