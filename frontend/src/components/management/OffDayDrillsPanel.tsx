/**
 * Off-Day Drills — memorization trainer for the fleet's run/off schedule.
 *
 * Three drills over the live fleet (plus a reference board): Leitner
 * flashcards, a which-day quiz, and a "who's off <day>" recall grid. Spares
 * carry no schedule — they run only on coverage — so they appear as identity
 * cards but never in schedule questions, and any stale scheduled_off_days on
 * a Spare row is ignored (same rule as day seeding).
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import { useFleet } from "../../api/hooks";
import { truckTypeLabel } from "../../utils/truckType";
import type { Truck } from "../../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const isSpare = (t: Truck) => t.truck_type === "Spare";
const offDays = (t: Truck) => (isSpare(t) ? [] : t.scheduled_off_days ?? []);

/**
 * Curated mnemonics for the schedule as of 2026-09-12, each one fact-checked
 * against that snapshot. They are prose about SPECIFIC numbers, so they can't
 * be computed from live data — instead TIPS_FINGERPRINT pins the schedule they
 * describe, and the Tips tab falls back to the always-computed basics the
 * moment any truck's off day changes.
 */
const TIPS_FINGERPRINT =
  "4:2,7:3,50:1,51:1,52:5,53:1,54:2,55:4,56:1,57:4,58:2,59:5,60:3,61:5,62:3,64:4,65:2,66:5,68:5,69:1,70:5,73:2,75:5,80:2,81:4,82:1,83:3,84:3,85:1,86:2,87:1,88:3,89:5,91:1,92:5,93:4,94:5,95:1";

const TIPS: { group: "learn" | "pattern"; title: string; tip: string }[] = [
  {
    group: "learn",
    title: "Climb the ladder",
    tip: "Learn days smallest-first: Thu 5 → Wed 6 → Tue 7 → then Mon and Fri (10 each). Once the three small days are solid, everything left is automatically a Monday or Friday truck.",
  },
  {
    group: "learn",
    title: "The checksum",
    tip: "Mon 10 · Tue 7 · Wed 6 · Thu 5 · Fri 10. Recite today's off list each morning, then count what you named — a wrong count means you dropped or added a truck, no answer key needed.",
  },
  {
    group: "learn",
    title: "Keep it fresh",
    tip: "Run Who's Off on today's day before each shift. Once the deck feels easy, do one cold full write-out a week and send anything you misplace back through the flashcards.",
  },
  {
    group: "pattern",
    title: "Thursday's short list",
    tip: "Only five trucks sit out Thursday: the odd pair 55 & 57, then 64, and F.S. 81 & 93. If you name a sixth Thursday truck, you've made a mistake.",
  },
  {
    group: "pattern",
    title: "Wednesday six",
    tip: "Lucky truck 7, the even pair 60 & 62, and the F.S. trio 83-84-88. Guardrail: no 50-something truck is ever off on Wednesday.",
  },
  {
    group: "pattern",
    title: "The 50s",
    tip: "Monday takes four: 50, 51, 53, 56. The rest come in pairs — 54 & 58 Tuesday, 55 & 57 Thursday, 52 & 59 Friday. That's all ten.",
  },
  {
    group: "pattern",
    title: "60s: evens forward, odds backward",
    tip: "Even 60s slide later as they climb: 60 & 62 Wed, 64 Thu, 66 & 68 Fri. Odd 60s run the week backwards: 61 Fri, 65 Tue, 69 Mon.",
  },
  {
    group: "pattern",
    title: "The 80s",
    tip: "Monday trio 82-85-87, Tuesday pair 80 & 86, Wednesday trio 83-84-88, and a loner at each end of the week: 81 is the only 80s Thursday, 89 the only 80s Friday.",
  },
  {
    group: "pattern",
    title: "The 90s mirror",
    tip: "A mirror centered on 93 (Thursday): one step out either way is Friday (92 & 94), two steps out is Monday (91 & 95).",
  },
  {
    group: "pattern",
    title: "Ends-in-3 ladder",
    tip: "Trucks ending in 3 climb one rung per decade: 53 Monday, 73 Tuesday, 83 Wednesday, 93 Thursday.",
  },
  {
    group: "pattern",
    title: "Bookends",
    tip: "The fleet opens on Tuesday and closes on Monday: the lowest trucks of each type (4 and 80) are off Tuesday, the highest (91 and 95) are off Monday.",
  },
  {
    group: "pattern",
    title: "Monday block",
    tip: "Monday's uniform group is the low-50s run 50-51-53-56 plus 69 and big 91; the F.S. Monday four are 82, 85, 87, 95.",
  },
  {
    group: "pattern",
    title: "Friday hooks",
    tip: "The even run 66-68-70 (odd 69 skips out to Monday), and 59 & 61 sandwiching Wednesday's 60. Add 52 and 75, then F.S. 89, 92, 94.",
  },
  {
    group: "pattern",
    title: "Tuesday seven",
    tip: "The two openers 4 & 80, the 54 & 58 pair, loners 65 and 73, and F.S. 86. Seven total.",
  },
];

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem("rr-drills:" + k);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem("rr-drills:" + k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

function TypeChips({ t }: { t: Truck }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      <span
        className={clsx(
          "rounded-full border border-hairline bg-surface-2 px-2.5 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.08em]",
          t.truck_type === "Dust" ? "text-amber-300" : isSpare(t) ? "text-cyan-300" : "text-ink-muted",
        )}
      >
        {truckTypeLabel(t.truck_type)}
      </span>
      {t.is_oos && (
        <span className="rounded-full border border-hairline bg-surface-2 px-2.5 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          OOS now
        </span>
      )}
    </div>
  );
}

function DayStrip({ t }: { t: Truck }) {
  const off = offDays(t);
  return (
    <div className="grid w-full max-w-[330px] grid-cols-5 gap-1.5">
      {DAYS.map((nm, i) => {
        const isOff = off.includes(i + 1);
        return (
          <div
            key={nm}
            className={clsx(
              "flex flex-col items-center gap-px rounded-lg border border-hairline py-2",
              isOff ? "bg-st-off/20" : "bg-st-unloaded/15",
            )}
          >
            <span className={clsx("text-[11.5px] font-bold", isOff ? "text-st-off line-through" : "text-st-unloaded")}>
              {nm}
            </span>
            <span className="font-mono text-[9.5px] text-ink-muted">Day {i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

function offText(t: Truck) {
  if (isSpare(t)) return <>Spare — runs only when it's covering a route</>;
  const off = offDays(t);
  if (off.length === 0) return <>Runs every day</>;
  return (
    <>
      Off{" "}
      {off.map((d, i) => (
        <span key={d} className="text-ink">
          {i > 0 && " & "}
          {DAYS[d - 1]} (Day {d})
        </span>
      ))}
    </>
  );
}

function TipsSection({ fingerprintMatches, dayCounts }: { fingerprintMatches: boolean; dayCounts: number[] }) {
  const groups: { id: "learn" | "pattern"; heading: string }[] = [
    { id: "learn", heading: "How to learn it" },
    { id: "pattern", heading: "Number patterns" },
  ];
  return (
    <div className="space-y-3">
      {!fingerprintMatches && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3.5 py-3 text-[13px] text-amber-200">
          The schedule has changed since these patterns were written, so the pattern tips are hidden —
          they may no longer be true. The counts below are live. Ask for a tips refresh when the new
          schedule settles.
        </div>
      )}
      <div className="rounded-xl border border-hairline bg-surface px-3.5 py-3">
        <p className="mb-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          Off-counts by day
        </p>
        <p className="font-mono text-sm font-bold text-ink-soft">
          {DAYS.map((nm, i) => `${nm} ${dayCounts[i]}`).join(" · ")}
        </p>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Every route truck is off exactly one day — use these counts to self-check any list you recite.
        </p>
      </div>
      {fingerprintMatches &&
        groups.map((g) => (
          <div key={g.id} className="space-y-2">
            <p className="pt-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{g.heading}</p>
            {TIPS.filter((t) => t.group === g.id).map((t) => (
              <div key={t.title} className="rounded-xl border border-hairline bg-surface px-3.5 py-3">
                <p className="text-sm font-bold text-ink">{t.title}</p>
                <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">{t.tip}</p>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

export default function OffDayDrillsPanel() {
  const { data: fleet } = useFleet(false);
  const trucks = useMemo(() => (fleet ?? []).slice().sort((a, b) => a.truck_number - b.truck_number), [fleet]);
  const routeTrucks = useMemo(() => trucks.filter((t) => !isSpare(t)), [trucks]);

  const [mode, setMode] = useState<"cards" | "quiz" | "who" | "board" | "tips">("cards");

  // ---- flashcards (3-box Leitner) ----
  const [boxes, setBoxes] = useState<Record<number, number>>(() => store.get("boxes", {}));
  const [filter, setFilter] = useState<"all" | "Uniform" | "Dust" | "Spare">("all");
  const deck = useMemo(
    () => trucks.filter((t) => (filter === "all" ? true : t.truck_type === filter)),
    [trucks, filter],
  );
  const [cardNum, setCardNum] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const card = deck.find((t) => t.truck_number === cardNum) ?? deck[0];

  function pickCard(nextBoxes: Record<number, number>, avoid?: number) {
    // weight: box0 ×6, box1 ×3, box2 ×1 — weak cards come around far more often
    const pool: Truck[] = [];
    deck.forEach((t) => {
      const w = [6, 3, 1][nextBoxes[t.truck_number] ?? 0];
      for (let i = 0; i < w; i++) pool.push(t);
    });
    if (pool.length === 0) return;
    let pick = pool[Math.floor(Math.random() * pool.length)];
    let guard = 0;
    while (avoid != null && pick.truck_number === avoid && pool.some((p) => p.truck_number !== avoid) && guard++ < 15)
      pick = pool[Math.floor(Math.random() * pool.length)];
    setCardNum(pick.truck_number);
    setRevealed(false);
  }
  function grade(ok: boolean) {
    if (!card) return;
    const b = boxes[card.truck_number] ?? 0;
    const next = { ...boxes, [card.truck_number]: ok ? Math.min(2, b + 1) : 0 };
    setBoxes(next);
    store.set("boxes", next);
    pickCard(next, card.truck_number);
  }
  const boxCounts = useMemo(() => {
    const c = [0, 0, 0];
    deck.forEach((t) => c[boxes[t.truck_number] ?? 0]++);
    return c;
  }, [deck, boxes]);
  const solidRoutes = routeTrucks.filter((t) => (boxes[t.truck_number] ?? 0) === 2).length;

  // ---- quiz ----
  const quizDeck = useMemo(() => routeTrucks.filter((t) => offDays(t).length === 1), [routeTrucks]);
  const [quizNum, setQuizNum] = useState<number | null>(null);
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState<number>(() => store.get("qbest", 0));
  const [score, setScore] = useState({ right: 0, total: 0 });
  const quizTruck = quizDeck.find((t) => t.truck_number === quizNum) ?? quizDeck[0];

  function quizNext() {
    if (quizDeck.length === 0) return;
    let pick = quizDeck[Math.floor(Math.random() * quizDeck.length)];
    let guard = 0;
    while (quizTruck && pick.truck_number === quizTruck.truck_number && quizDeck.length > 1 && guard++ < 15)
      pick = quizDeck[Math.floor(Math.random() * quizDeck.length)];
    setQuizNum(pick.truck_number);
    setQuizAnswer(null);
  }
  function answer(day: number) {
    if (!quizTruck || quizAnswer != null) return;
    setQuizAnswer(day);
    const ok = offDays(quizTruck)[0] === day;
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }));
    if (ok) {
      const next = streak + 1;
      setStreak(next);
      if (next > best) {
        setBest(next);
        store.set("qbest", next);
      }
    } else setStreak(0);
  }

  // ---- who's off ----
  const jsDay = new Date().getDay();
  const [whoDay, setWhoDay] = useState(jsDay >= 1 && jsDay <= 5 ? jsDay : 1);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [checked, setChecked] = useState(false);
  const whoTruth = useMemo(() => routeTrucks.filter((t) => offDays(t).includes(whoDay)), [routeTrucks, whoDay]);

  if (!fleet) return <p className="text-sm text-ink-muted">Loading fleet…</p>;
  if (trucks.length === 0) return <p className="text-sm text-ink-muted">No active trucks yet.</p>;

  const tabBtn = (id: typeof mode, label: string) => (
    <button
      key={id}
      onClick={() => setMode(id)}
      className={clsx(
        "rounded-lg px-2 py-2 text-[12.5px] font-bold transition-colors",
        mode === id ? "bg-blue-600 text-white" : "text-ink-muted hover:text-ink-soft",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-md space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-ink-muted">Learn which day each truck is off.</p>
        <p className="font-mono text-xs font-bold text-ink-muted">
          <span className="text-st-unloaded">{solidRoutes}</span>/{routeTrucks.length} routes solid
        </p>
      </div>

      <div className="grid grid-cols-5 gap-1 rounded-xl border border-hairline bg-surface-2 p-1">
        {tabBtn("cards", "Cards")}
        {tabBtn("quiz", "Quiz")}
        {tabBtn("who", "Who's Off")}
        {tabBtn("board", "Board")}
        {tabBtn("tips", "Tips")}
      </div>

      {mode === "cards" && card && (
        <div className="space-y-2.5">
          <div className="flex gap-1.5">
            {([["all", "All"], ["Uniform", "Uniform"], ["Dust", "F.S."], ["Spare", "Spares"]] as const).map(([f, label]) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f);
                  setCardNum(null);
                  setRevealed(false);
                }}
                className={clsx(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  filter === f
                    ? "border-blue-500 bg-blue-900/30 text-ink"
                    : "border-hairline bg-surface-2 text-ink-muted hover:bg-track",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="flex min-h-[280px] w-full cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border border-hairline bg-surface px-4 py-6 text-center"
          >
            <TypeChips t={card} />
            <span className="text-8xl font-black leading-none tracking-wide text-ink">{card.truck_number}</span>
            {revealed ? (
              <div className="flex w-full flex-col items-center gap-2.5">
                <p className="text-[15px] font-bold text-ink-soft">{offText(card)}</p>
                {!isSpare(card) && <DayStrip t={card} />}
              </div>
            ) : (
              <span className="text-xs text-ink-muted">Tap to reveal</span>
            )}
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={!revealed}
              onClick={() => grade(false)}
              className="rounded-xl border border-hairline bg-surface-2 py-3 text-[15px] font-bold text-ink-soft disabled:opacity-40"
            >
              Again
            </button>
            <button
              disabled={!revealed}
              onClick={() => grade(true)}
              className="rounded-xl border border-emerald-700/50 bg-emerald-900/25 py-3 text-[15px] font-bold text-emerald-300 disabled:opacity-40"
            >
              Got it
            </button>
          </div>
          <p className="text-center font-mono text-[11px] text-ink-muted">
            learning <b className="text-ink-soft">{boxCounts[0]}</b> · almost{" "}
            <b className="text-ink-soft">{boxCounts[1]}</b> · solid <b className="text-ink-soft">{boxCounts[2]}</b>
          </p>
        </div>
      )}

      {mode === "quiz" &&
        (quizTruck ? (
          <div className="space-y-2.5">
            <div className="rounded-2xl border border-hairline bg-surface px-4 py-5 text-center">
              <p className="text-sm text-ink-muted">Which day is this truck off?</p>
              <p className="my-1 text-6xl font-black leading-tight text-ink">{quizTruck.truck_number}</p>
              <TypeChips t={quizTruck} />
              <div className="mt-3.5 grid grid-cols-5 gap-1.5">
                {DAYS.map((nm, i) => {
                  const d = i + 1;
                  const right = quizAnswer != null && offDays(quizTruck)[0] === d;
                  const wrong = quizAnswer === d && !right;
                  return (
                    <button
                      key={nm}
                      onClick={() => answer(d)}
                      className={clsx(
                        "flex flex-col items-center gap-px rounded-lg border py-2.5 text-[13px] font-bold",
                        right
                          ? "border-emerald-600/60 bg-st-unloaded/15 text-emerald-300"
                          : wrong
                            ? "border-red-600/60 bg-red-900/25 text-red-300"
                            : "border-hairline bg-surface-2 text-ink-soft hover:bg-track",
                      )}
                    >
                      {nm}
                      <span className="font-mono text-[9.5px] font-medium text-ink-muted">Day {d}</span>
                    </button>
                  );
                })}
              </div>
              <p
                className={clsx(
                  "mt-2.5 min-h-[22px] text-sm font-bold",
                  quizAnswer == null ? "" : offDays(quizTruck)[0] === quizAnswer ? "text-emerald-300" : "text-red-300",
                )}
              >
                {quizAnswer != null &&
                  (offDays(quizTruck)[0] === quizAnswer
                    ? `Right — #${quizTruck.truck_number} is off ${DAYS[quizAnswer - 1]}.`
                    : `#${quizTruck.truck_number} is off ${DAYS[offDays(quizTruck)[0] - 1]} (Day ${offDays(quizTruck)[0]}).`)}
              </p>
              {quizAnswer != null && (
                <button
                  onClick={quizNext}
                  className="mt-1 w-full rounded-xl bg-blue-600 py-3 text-[15px] font-bold text-white hover:bg-blue-500"
                >
                  Next truck
                </button>
              )}
            </div>
            <p className="text-center font-mono text-xs font-bold text-ink-muted">
              streak <b className="text-ink">{streak}</b> · best <b className="text-ink">{best}</b> · today{" "}
              <b className="text-ink">
                {score.right}/{score.total}
              </b>
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No route trucks with a single off day to quiz on.</p>
        ))}

      {mode === "who" && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-5 gap-1.5">
            {DAYS.map((nm, i) => (
              <button
                key={nm}
                onClick={() => {
                  setWhoDay(i + 1);
                  setPicked(new Set());
                  setChecked(false);
                }}
                className={clsx(
                  "flex flex-col items-center gap-px rounded-lg border py-2 text-[12.5px] font-bold",
                  whoDay === i + 1
                    ? "border-blue-500 bg-blue-900/30 text-ink"
                    : "border-hairline bg-surface-2 text-ink-muted hover:bg-track",
                )}
              >
                {nm}
                <span className="font-mono text-[9.5px] font-medium">Day {i + 1}</span>
              </button>
            ))}
          </div>
          <p className="text-[13px] text-ink-muted">
            Tap every <b className="text-ink-soft">route truck</b> that's off. Spares aren't in this drill.
          </p>
          <div className="grid grid-cols-6 gap-1.5">
            {routeTrucks.map((t) => {
              const n = t.truck_number;
              const isOff = offDays(t).includes(whoDay);
              const isPicked = picked.has(n);
              return (
                <button
                  key={n}
                  onClick={() => {
                    if (checked) return;
                    const next = new Set(picked);
                    isPicked ? next.delete(n) : next.add(n);
                    setPicked(next);
                  }}
                  className={clsx(
                    "rounded-lg border py-2.5 font-mono text-base font-bold",
                    t.truck_type === "Dust" ? "text-amber-300" : "text-ink-soft",
                    checked && isOff && isPicked
                      ? "border-emerald-600/60 bg-st-unloaded/15"
                      : checked && isOff
                        ? "border-red-500/70 bg-surface"
                        : checked && isPicked
                          ? "border-red-600/60 bg-red-900/25"
                          : isPicked
                            ? "border-st-off bg-st-off/20 text-ink"
                            : "border-hairline bg-surface",
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setPicked(new Set());
                setChecked(false);
              }}
              className="rounded-xl border border-hairline bg-surface-2 py-3 text-[15px] font-bold text-ink-soft"
            >
              Clear
            </button>
            <button
              onClick={() => {
                if (checked) {
                  setPicked(new Set());
                  setChecked(false);
                } else setChecked(true);
              }}
              className="rounded-xl bg-blue-600 py-3 text-[15px] font-bold text-white hover:bg-blue-500"
            >
              {checked ? "Try again" : "Check"}
            </button>
          </div>
          {checked && (
            <p className="text-center text-sm font-bold text-ink-soft">
              {(() => {
                const hits = whoTruth.filter((t) => picked.has(t.truck_number)).length;
                const wrongPicks = [...picked].filter((n) => !whoTruth.some((t) => t.truck_number === n)).length;
                return hits === whoTruth.length && wrongPicks === 0
                  ? `Perfect — all ${whoTruth.length} off-trucks for ${DAYS[whoDay - 1]}.`
                  : `${hits}/${whoTruth.length} found${wrongPicks ? `, ${wrongPicks} wrong pick${wrongPicks > 1 ? "s" : ""}` : ""} — missed trucks are outlined red.`;
              })()}
            </p>
          )}
        </div>
      )}

      {mode === "tips" && (
        <TipsSection
          fingerprintMatches={
            routeTrucks.map((t) => `${t.truck_number}:${offDays(t).join("")}`).join(",") === TIPS_FINGERPRINT
          }
          dayCounts={DAYS.map((_, i) => routeTrucks.filter((t) => offDays(t).includes(i + 1)).length)}
        />
      )}

      {mode === "board" && (
        <div className="space-y-2.5">
          {DAYS.map((nm, i) => {
            const off = routeTrucks.filter((t) => offDays(t).includes(i + 1));
            return (
              <div key={nm} className="rounded-xl border border-hairline bg-surface px-3.5 py-3">
                <p className="mb-2 flex items-baseline justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  Off {nm}
                  <span className="font-mono text-[10.5px] font-medium normal-case">
                    Day {i + 1} · {off.length} trucks
                  </span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {off.map((t) => (
                    <span
                      key={t.truck_number}
                      className={clsx(
                        "rounded-md border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-sm font-bold",
                        t.truck_type === "Dust" ? "text-amber-300" : "text-ink-soft",
                      )}
                    >
                      {t.truck_number}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="rounded-xl border border-hairline bg-surface px-3.5 py-3">
            <p className="mb-2 flex items-baseline justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              Spares — run as needed
              <span className="font-mono text-[10.5px] font-medium normal-case">coverage only</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {trucks.filter(isSpare).map((t) => (
                <span
                  key={t.truck_number}
                  className="rounded-md border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-sm font-bold text-cyan-300"
                >
                  {t.truck_number}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
