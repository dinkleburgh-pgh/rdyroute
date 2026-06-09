/**
 * Communications censor-words panel. Extracted from Settings.tsx.
 * Uses better-profanity (1,400+ built-in words). Custom additions only — the
 * full list is never displayed in the UI.
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

  return (
    <div className="card space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-300">Profanity filter</p>
        <p className="text-xs text-slate-500">
          Messages are filtered with a built-in word list. Custom additions managed here.
          {!editing && words.length > 0 && (
            <span className="ml-1 text-slate-600">({words.length} custom words)</span>
          )}
        </p>
      </div>

      {!editing ? (
        <button
          className="btn-primary text-xs"
          onClick={() => setEditing(true)}
        >
          Manage Custom Words
        </button>
      ) : (
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
          ) : words.length > 0 ? (
            <p className="text-xs text-slate-500">
              {words.length} custom word{words.length !== 1 ? "s" : ""} active.{" "}
              <button
                className="text-red-400 hover:text-red-300 underline"
                disabled={update.isPending}
                onClick={() => update.mutate([])}
              >
                Clear all
              </button>
            </p>
          ) : (
            <p className="text-xs text-slate-500">No custom words configured.</p>
          )}
          <div className="flex gap-2">
            <button
              className="btn-ghost text-xs"
              onClick={() => setEditing(false)}
            >
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}
