import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, X, Copy, RotateCcw, Delete, Equal } from "lucide-react";
import { useTrackedItems } from "../api/hooks";

type Op = "+" | "-" | "×" | "÷";

interface TapeEntry {
  expr: string;
  result: number;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

export default function CalculatorFab() {
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [tape, setTape] = useState<TapeEntry[]>([]);
  const [memory, setMemory] = useState<number>(0);
  const [showMem, setShowMem] = useState(false);
  const [packMode, setPackMode] = useState<"packs" | "pieces">("packs");
  const [packItem, setPackItem] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const { data: trackedItems = [] } = useTrackedItems();
  const itemsWithPack = trackedItems.filter((i) => i.pack_size != null && i.pack_size > 0);
  const selectedItem = trackedItems.find((i) => i.label === packItem);
  const packSize = selectedItem?.pack_size ?? 1;
  const unitLabel = selectedItem?.unit_label ?? "Pack";

  const val = parseFloat(display);

  const appendDigit = useCallback((d: string) => {
    if (waiting) { setDisplay(d); setWaiting(false); return; }
    setDisplay((s) => s === "0" && d !== "." ? d : s + d);
  }, [waiting]);

  const setOpState = useCallback((next: Op) => {
    const n = parseFloat(display);
    if (prev == null) { setPrev(n); setOp(next); setWaiting(true); return; }
    let r = 0;
    if (op === "+") r = prev! + n;
    else if (op === "-") r = prev! - n;
    else if (op === "×") r = prev! * n;
    else if (op === "÷") r = prev! / n;
    setDisplay(fmt(r));
    setTape((t) => [...t, { expr: `${fmt(prev!)} ${op} ${fmt(n)}`, result: r }]);
    setPrev(r);
    setOp(next);
    setWaiting(true);
  }, [display, prev, op]);

  const compute = useCallback(() => {
    if (prev == null || !op) return;
    const n = parseFloat(display);
    let r = 0;
    if (op === "+") r = prev + n;
    else if (op === "-") r = prev - n;
    else if (op === "×") r = prev * n;
    else if (op === "÷") r = prev / n;
    setDisplay(fmt(r));
    setTape((t) => [...t, { expr: `${fmt(prev)} ${op} ${fmt(n)}`, result: r }]);
    setPrev(null);
    setOp(null);
    setWaiting(true);
  }, [display, prev, op]);

  const clear = useCallback(() => {
    setDisplay("0");
    setPrev(null);
    setOp(null);
    setWaiting(false);
  }, []);

  const backspace = useCallback(() => {
    if (waiting) return;
    setDisplay((s) => (s.length > 1 ? s.slice(0, -1) : "0"));
  }, [waiting]);

  const toggleSign = useCallback(() => {
    setDisplay((s) => (s.startsWith("-") ? s.slice(1) : "-" + s));
  }, []);

  const memAdd = useCallback(() => { setMemory((m) => m + val); setShowMem(true); setTimeout(() => setShowMem(false), 1000); }, [val]);
  const memSub = useCallback(() => { setMemory((m) => m - val); setShowMem(true); setTimeout(() => setShowMem(false), 1000); }, [val]);
  const memRecall = useCallback(() => { setDisplay(fmt(memory)); if (waiting) setWaiting(false); }, [memory, waiting]);
  const memClear = useCallback(() => { setMemory(0); }, []);

  const convertToPieces = useCallback(() => {
    const pieces = val * packSize;
    setDisplay(fmt(pieces));
    setTape((t) => [...t, { expr: `${fmt(val)} ${unitLabel} × ${packSize} pcs/${unitLabel}`, result: pieces }]);
  }, [val, packSize, unitLabel]);

  const convertToPacks = useCallback(() => {
    if (val === 0) return;
    const packs = val / packSize;
    setDisplay(fmt(packs));
    setTape((t) => [...t, { expr: `${fmt(val)} pcs ÷ ${packSize} pcs/${unitLabel}`, result: packs }]);
  }, [val, packSize, unitLabel]);

  const useResult = useCallback(async () => {
    const text = display;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }, [display]);

  const clearTape = useCallback(() => setTape([]), []);

  const btn = "flex h-11 w-full items-center justify-center rounded-lg text-sm font-semibold transition-colors active:scale-95 select-none";

  const numBg = "bg-slate-800 text-slate-100 hover:bg-slate-700";
  const opBg = "bg-slate-700 text-sky-300 hover:bg-slate-600";
  const eqBg = "bg-sky-600 text-white hover:bg-sky-500";
  const auxBg = "bg-slate-800/60 text-slate-400 hover:bg-slate-700/60";
  const convBg = "bg-emerald-900/30 text-emerald-400 hover:bg-emerald-800/40 border border-emerald-700/30";

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg shadow-sky-900/40 transition-all hover:bg-sky-500 hover:scale-110 active:scale-95 md:bottom-6"
        aria-label="Open calculator"
      >
        <Calculator className="h-5 w-5" />
      </button>

      {/* Overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 md:p-4 md:items-center"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 300, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="flex h-full w-full flex-col bg-slate-900 p-4 shadow-2xl md:max-w-sm md:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-sky-400" />
                  <span className="text-sm font-semibold text-slate-100">Calculator</span>
                  {showMem && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      M={fmt(memory)}
                    </span>
                  )}
                </div>
                <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-500 hover:text-slate-300">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Display */}
              <div className="mb-3 overflow-hidden rounded-xl bg-slate-950 p-3">
                <div className="w-full bg-transparent text-right text-3xl font-bold tabular-nums text-slate-100 outline-none select-none">
                  {display}
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                  <span>{prev != null ? `${fmt(prev)} ${op ?? ""}` : "\u00a0"}</span>
                  {selectedItem && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-emerald-400">
                      {packMode === "packs" ? `${unitLabel}s` : "Pieces"} &middot; {packSize}/{unitLabel}
                    </span>
                  )}
                </div>
              </div>

              {/* Pack converter row */}
              <div className="mb-3 flex items-center gap-2">
                <select
                  value={packItem}
                  onChange={(e) => setPackItem(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 outline-none"
                >
                  <option value="">No item</option>
                  {itemsWithPack.map((i) => (
                    <option key={i.label} value={i.label}>
                      {i.label} ({i.pack_size} {i.unit_label ?? "pcs"}/ea)
                    </option>
                  ))}
                </select>
                <button onClick={() => setPackMode(packMode === "packs" ? "pieces" : "packs")} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${convBg}`}>
                  {packMode === "packs" ? "→ Pieces" : "→ Packs"}
                </button>
                {selectedItem && (
                  <button onClick={packMode === "packs" ? convertToPieces : convertToPacks} className={convBg + " rounded-lg px-2.5 py-1.5 text-[10px] font-semibold"}>
                    Convert
                  </button>
                )}
              </div>

              {/* Number pad & operations */}
              <div className="grid grid-cols-4 gap-1.5">
                {/* Row 1 */}
                <button onClick={clear} className={`${auxBg} text-amber-400`}><RotateCcw className="h-4 w-4" /></button>
                <button onClick={backspace} className={`${auxBg}`}><Delete className="h-4 w-4" /></button>
                <button onClick={toggleSign} className={`${auxBg}`}>±</button>
                <button onClick={() => setOpState("÷")} className={`${op ?? ""}` === "÷" ? "bg-sky-600 text-white" : opBg}>÷</button>

                {/* Row 2 */}
                <button onClick={() => appendDigit("7")} className={numBg}>7</button>
                <button onClick={() => appendDigit("8")} className={numBg}>8</button>
                <button onClick={() => appendDigit("9")} className={numBg}>9</button>
                <button onClick={() => setOpState("×")} className={`${op ?? ""}` === "×" ? "bg-sky-600 text-white" : opBg}>×</button>

                {/* Row 3 */}
                <button onClick={() => appendDigit("4")} className={numBg}>4</button>
                <button onClick={() => appendDigit("5")} className={numBg}>5</button>
                <button onClick={() => appendDigit("6")} className={numBg}>6</button>
                <button onClick={() => setOpState("-")} className={`${op ?? ""}` === "-" ? "bg-sky-600 text-white" : opBg}>-</button>

                {/* Row 4 */}
                <button onClick={() => appendDigit("1")} className={numBg}>1</button>
                <button onClick={() => appendDigit("2")} className={numBg}>2</button>
                <button onClick={() => appendDigit("3")} className={numBg}>3</button>
                <button onClick={() => setOpState("+")} className={`${op ?? ""}` === "+" ? "bg-sky-600 text-white" : opBg}>+</button>

                {/* Row 5 */}
                <button onClick={() => appendDigit("0")} className={numBg + " col-span-2"}>0</button>
                <button onClick={() => appendDigit(".")} className={numBg}>.</button>
                <button onClick={compute} className={eqBg}><Equal className="h-4 w-4" /></button>
              </div>

              {/* Quick percent row */}
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                <button onClick={() => { const r = val * 0.5; setDisplay(fmt(r)); setTape((t) => [...t, { expr: `50% of ${fmt(val)}`, result: r }]); }} className="bg-indigo-900/30 text-indigo-400 hover:bg-indigo-800/40 border border-indigo-700/30 rounded-lg py-2 text-[10px] font-semibold">50%</button>
                <button onClick={() => { const r = val * 0.8; setDisplay(fmt(r)); setTape((t) => [...t, { expr: `80% of ${fmt(val)}`, result: r }]); }} className="bg-indigo-900/30 text-indigo-400 hover:bg-indigo-800/40 border border-indigo-700/30 rounded-lg py-2 text-[10px] font-semibold">80%</button>
                <div />
                <div />
                <button onClick={useResult} className={`flex items-center justify-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition-colors ${copied ? "bg-emerald-600 text-white" : "bg-sky-600 text-white hover:bg-sky-500"}`}>
                  {copied ? <span>Copied</span> : <><Copy className="h-3 w-3" /> Use</>}
                </button>
              </div>

              {/* Memory row */}
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                <button onClick={memClear} className={`${auxBg} text-[10px]`}>MC</button>
                <button onClick={memRecall} className={`${auxBg} text-[10px]`}>MR</button>
                <button onClick={memAdd} className={`${auxBg} text-[10px]`}>M+</button>
                <button onClick={memSub} className={`${auxBg} text-[10px]`}>M-</button>
              </div>

              {/* Tape — always visible, flex-grow on mobile */}
              <div className="mt-3 flex-1 overflow-y-auto min-h-0 md:min-h-0">
                {tape.length > 0 ? (
                  <div className="rounded-lg bg-slate-950 p-2">
                    {tape.map((t, i) => (
                      <div key={i} className="flex justify-between py-0.5 text-[10px]">
                        <span className="text-slate-500">{t.expr}</span>
                        <span className="font-semibold text-slate-200">= {fmt(t.result)}</span>
                      </div>
                    ))}
                    <button onClick={clearTape} className="mt-1 text-[9px] text-slate-600 hover:text-slate-400">Clear history</button>
                  </div>
                ) : (
                  <div className="text-center text-[10px] text-slate-600">No calculations yet</div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}