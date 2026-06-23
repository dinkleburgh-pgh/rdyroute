import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, X, Copy, Delete, Equal } from "lucide-react";

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
  const [packItem, setPackItem] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const CALC_ITEMS = [
    { label: "Terrys/Grids", pack_size: 20 },
    { label: "White Micros", pack_size: 20 },
    { label: "Red Shops",    pack_size: 50 },
    { label: "Black Aprons", pack_size: 10 },
    { label: "White Aprons", pack_size: 10 },
  ];
  const selectedItem = CALC_ITEMS.find((i) => i.label === packItem);
  const packSize = selectedItem?.pack_size ?? 1;

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

  const clearAll = useCallback(() => { setDisplay("0"); setPrev(null); setOp(null); setWaiting(false); setTape([]); }, []);
  const backspace = useCallback(() => { if (waiting) return; setDisplay((s) => (s.length > 1 ? s.slice(0, -1) : "0")); }, [waiting]);
  const toggleSign = useCallback(() => { setDisplay((s) => (s.startsWith("-") ? s.slice(1) : "-" + s)); }, []);

  const memAdd = useCallback(() => { setMemory((m) => m + val); setShowMem(true); setTimeout(() => setShowMem(false), 1000); }, [val]);
  const memSub = useCallback(() => { setMemory((m) => m - val); setShowMem(true); setTimeout(() => setShowMem(false), 1000); }, [val]);
  const memRecall = useCallback(() => { setDisplay(fmt(memory)); if (waiting) setWaiting(false); }, [memory, waiting]);
  const memClear = useCallback(() => { setMemory(0); }, []);

  const useResult = useCallback(async () => {
    try { await navigator.clipboard.writeText(display); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { }
  }, [display]);

  const clearTape = useCallback(() => setTape([]), []);

  const numBg = "bg-slate-800 text-slate-100 hover:bg-slate-700 active:bg-slate-600";
  const opBg = "bg-slate-700 text-sky-300 hover:bg-slate-600 active:bg-slate-500";
  const eqBg = "bg-sky-600 text-white hover:bg-sky-500 active:bg-sky-400";
  const auxBg = "bg-slate-800/60 text-slate-400 hover:bg-slate-700/60";

  const pctOp = "bg-indigo-900/30 text-indigo-400 hover:bg-indigo-800/40 border border-indigo-700/30 rounded-lg text-[10px] font-semibold active:scale-95 select-none";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg shadow-sky-900/40 transition-all hover:bg-sky-500 hover:scale-110 active:scale-95 md:bottom-6"
        aria-label="Open calculator"
      >
        <Calculator className="h-5 w-5" />
      </button>

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
              className="flex h-full w-full flex-col bg-slate-900 shadow-2xl md:max-w-sm md:rounded-2xl md:p-4"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between px-3 pb-2 pt-3 md:px-0 md:pt-0">
                <div className="flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-sky-400" />
                  <span className="text-sm font-semibold text-slate-100">Calculator</span>
                  {showMem && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">M={fmt(memory)}</span>}
                </div>
                <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-500 hover:text-slate-300">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Display + History */}
              <div className="mx-3 mb-1 flex shrink-0 flex-col overflow-hidden rounded-xl bg-slate-950 md:mx-0">
                <div className="px-3 pb-1 pt-2">
                  <div className="text-right text-3xl font-bold tabular-nums text-slate-100 select-none">
                    {display}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                    <span>{prev != null ? `${fmt(prev)} ${op ?? ""}` : "\u00a0"}</span>
                  </div>
                </div>
                <div className="max-h-[4.5rem] overflow-y-auto border-t border-slate-800/60 px-3 py-1">
                  {tape.length > 0 ? (
                    tape.map((t, i) => (
                      <div key={i} className="flex justify-between py-[1px] text-[10px]">
                        <span className="text-slate-500">{t.expr}</span>
                        <span className="font-semibold text-slate-200">= {fmt(t.result)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-[10px] text-slate-600">No calculations yet</div>
                  )}
                  {tape.length > 0 && (
                    <button onClick={clearTape} className="text-[9px] text-slate-600 hover:text-slate-400">Clear</button>
                  )}
                </div>
              </div>

              {/* Pack converter */}
              <div className="mx-3 mb-1 flex shrink-0 items-center gap-1.5 md:mx-0">
                <select value={packItem} onChange={(e) => setPackItem(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 outline-none">
                  <option value="">No item</option>
                  {CALC_ITEMS.map((i) => (
                    <option key={i.label} value={i.label}>{i.label} ({i.pack_size}/bag)</option>
                  ))}
                </select>
                {selectedItem?.pack_size && (
                  <button onClick={() => { const r = val * packSize; setDisplay(fmt(r)); setTape((t) => [...t, { expr: `${fmt(val)} bags × ${packSize}`, result: r }]); }}
                    className="rounded-lg bg-emerald-900/30 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-800/40 border border-emerald-700/30 active:scale-95 select-none">
                    ×{packSize}
                  </button>
                )}
              </div>

              {/* Quick percent buttons */}
              <div className="mx-3 mb-1 flex shrink-0 items-center gap-1.5 md:mx-0">
                <button onClick={() => { const r = val * 0.5; setDisplay(fmt(r)); setTape((t) => [...t, { expr: `50% of ${fmt(val)}`, result: r }]); }} className={`${pctOp} flex-1 py-2`}>50%</button>
                <button onClick={() => { const r = val * 0.8; setDisplay(fmt(r)); setTape((t) => [...t, { expr: `80% of ${fmt(val)}`, result: r }]); }} className={`${pctOp} flex-1 py-2`}>80%</button>
              </div>

              {/* Number pad — fills remaining space */}
              <div className="mx-3 flex flex-1 flex-col gap-1 pb-2 md:mx-0 md:pb-0">
                <div className="grid flex-1 grid-cols-4 gap-1">
                  <button onClick={clearAll} className={`${auxBg} rounded-lg text-sm font-bold active:scale-95 select-none text-amber-400`}>C</button>
                  <button onClick={backspace} className={`${auxBg} rounded-lg text-sm font-semibold active:scale-95 select-none`}><Delete className="h-4 w-4 mx-auto" /></button>
                  <button onClick={toggleSign} className={`${auxBg} rounded-lg text-sm font-semibold active:scale-95 select-none`}>±</button>
                  <button onClick={() => setOpState("÷")} className={`${(op ?? "") === "÷" ? "bg-sky-600 text-white" : opBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>÷</button>

                  <button onClick={() => appendDigit("7")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>7</button>
                  <button onClick={() => appendDigit("8")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>8</button>
                  <button onClick={() => appendDigit("9")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>9</button>
                  <button onClick={() => setOpState("×")} className={`${(op ?? "") === "×" ? "bg-sky-600 text-white" : opBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>×</button>

                  <button onClick={() => appendDigit("4")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>4</button>
                  <button onClick={() => appendDigit("5")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>5</button>
                  <button onClick={() => appendDigit("6")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>6</button>
                  <button onClick={() => setOpState("-")} className={`${(op ?? "") === "-" ? "bg-sky-600 text-white" : opBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>-</button>

                  <button onClick={() => appendDigit("1")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>1</button>
                  <button onClick={() => appendDigit("2")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>2</button>
                  <button onClick={() => appendDigit("3")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>3</button>
                  <button onClick={() => setOpState("+")} className={`${(op ?? "") === "+" ? "bg-sky-600 text-white" : opBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>+</button>

                  <button onClick={() => appendDigit("0")} className={`${numBg} col-span-2 rounded-lg text-lg font-bold active:scale-95 select-none`}>0</button>
                  <button onClick={() => appendDigit(".")} className={`${numBg} rounded-lg text-lg font-bold active:scale-95 select-none`}>.</button>
                  <button onClick={compute} className={`${eqBg} rounded-lg active:scale-95 select-none flex items-center justify-center`}><Equal className="h-5 w-5" /></button>
                </div>

                <div className="grid grid-cols-5 gap-1">
                  <button onClick={memClear} className={`${auxBg} rounded-lg text-[10px] font-semibold active:scale-95 select-none`}>MC</button>
                  <button onClick={memRecall} className={`${auxBg} rounded-lg text-[10px] font-semibold active:scale-95 select-none`}>MR</button>
                  <button onClick={memAdd} className={`${auxBg} rounded-lg text-[10px] font-semibold active:scale-95 select-none`}>M+</button>
                  <button onClick={memSub} className={`${auxBg} rounded-lg text-[10px] font-semibold active:scale-95 select-none`}>M-</button>
                  <button onClick={useResult} className={`flex items-center justify-center gap-1 rounded-lg text-[10px] font-semibold active:scale-95 select-none ${copied ? "bg-emerald-600 text-white" : "bg-sky-600 text-white hover:bg-sky-500"}`}>
                    {copied ? "Copied" : <><Copy className="h-3 w-3" /> Use</>}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}