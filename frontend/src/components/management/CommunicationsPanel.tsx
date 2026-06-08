/**
 * Communications censor-words panel. Extracted from Settings.tsx.
 */
import { useState } from "react";
import { useCensorWords, useUpdateCensorWords } from "../../api/hooks";

export default function CommunicationsPanel() {
  const { data: words = [], isLoading } = useCensorWords();
  const update = useUpdateCensorWords();
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);

  function addWord() {
    const w = input.trim().toLowerCase();
    if (!w || words.includes(w)) return;
    update.mutate([...words, w]);
    setInput("");
  }

  function removeWord(w: string) {
    update.mutate(words.filter((x) => x !== w));
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-300">Censor words</p>
          <p className="text-xs text-slate-500">
            Words in this list are replaced with asterisks in all outgoing messages.
            {!editing && words.length > 0 && (
              <span className="ml-1 text-slate-600">({words.length} configured)</span>
            )}
          </p>
        </div>
        <button
          className={editing ? "btn-ghost text-xs" : "btn-primary text-xs"}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing && (
        <>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Add word…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWord()}
            />
            <button
              className="btn-primary"
              disabled={!input.trim() || update.isPending}
              onClick={addWord}
            >
              Add
            </button>
          </div>
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : words.length === 0 ? (
            <p className="text-sm text-slate-500">No censor words configured.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {words.map((w) => (
                <span
                  key={w}
                  className="flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-200"
                >
                  {w}
                  <button
                    className="ml-1 text-slate-400 hover:text-red-400"
                    disabled={update.isPending}
                    onClick={() => removeWord(w)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
