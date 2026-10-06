"""Fair section rotation: who works which section in a week.

Pure — no database, no web framework. routers/rotation.py loads the recent
weeks (and who was on the roster each week), calls plan_week(), and writes the
rows it returns.

The goal, in the floor's words: everyone rotates through every section once
before anyone repeats one — and when there are more people than sections, the
sitting-out is shared the same way.

The model
---------
With P people there are exactly P positions a week: the sections that get
filled (main sections first, the floater last, so when there are fewer people
than sections it is the floater that goes empty) plus, when there are more
people than sections, P - S "sit out" slots. A full rotation is P weeks.

The ideal rotation is a fixed cycle of those P positions — the main sections
in fill order with the floater weeks spread between them, then the sit-out
weeks spread across all of those — that everyone walks one step a week from a
different point.
Real weeks are not clean (hand edits, people joining or leaving, staffing
going 4 -> 5 -> 4, a week built ahead or left empty), so each person is matched
to the point on the cycle their recent weeks fit best, and the week is solved
as a whole against these rules, strictly in this order:

  1. no back-to-back: nobody gets the position they held last week, or
     already hold next week if that week is built (floater duty is one
     position whichever floater it is; someone a hand edit left on two
     sections held both);
  2. fewest repeats this week: nobody gets a section they worked within their
     last P-1 weeks (each floater is its own section here; sit-outs: sooner
     than the even spacing P // (P-S));
  3. fair sit-outs: whoever has sat out least in their last P planned weeks
     sits out;
  4. fewest repeats over the coming weeks: when repeats are unavoidable (a
     fifth person joins, the floater opens up), choose the ones that let
     everyone settle straight into the new rotation — found by planning the
     next P-1 weeks ahead from each candidate and counting;
  5. keep the cycle: everyone takes their next position on it;
  6. longest-without first: the section a person has gone longest without;
  7. long-run balance across all the history given;
  8. ties break toward roster order, so a fresh rotation starts
     first person -> first section.

Rules 1-3 and 5-8 are solved exactly as one minimum-cost assignment
(Hungarian algorithm) whose weights are strictly lexicographic — each rule's
weight exceeds the largest possible total of every rule below it summed over
the whole week, in exact integers. Rule 4 needs a look-ahead: every
assignment that ties on rules 1-3 is played forward P-1 weeks with the same
solver and the one with the fewest future back-to-backs and repeats wins; the
rest of the order breaks ties. The look-ahead is exhaustive up to
ROLLOUT_MAX_PEOPLE people (a floor rotation); beyond that it is skipped and
rules 1-3 and 5-8 still hold exactly.

Measured on the real sections: a fifth person joining a clean four-person
rotation costs 3 repeats in the changeover week and none after (without the
look-ahead: 3 + 2 + 1 = 6, everyone dragging the old rhythm along until they
each get their turn on the floater); staffing flipping 4/5 every three weeks
for 30 weeks: 11 repeats (18 without).

Why not "shift everyone one along from last week" (the first builder): it only
ever looked one week back. Build a week whose previous week is empty —
building ahead, a gap, a rebuilt week — and it restarted from roster order, so
the same layout came round every other week (live data, Sep 21 = Oct 5,
Sep 28 = Oct 12: one person alternated two sections and never saw the other
two).
"""
from __future__ import annotations

import itertools
from typing import Collection, Mapping, Sequence

#: Largest roster the rule-4 look-ahead enumerates (6! = 720 candidates).
#: Measured worst case for one build: ~1 s at 6 people, 2.6 s at 7, 8 s at 8
#: (a newcomer joining) — a click waits on it, so bigger rosters skip it.
ROLLOUT_MAX_PEOPLE = 6

# Sits the week out. A private object, never an int: section ids are ints, and
# a sentinel that could equal one would silently merge a real section with the
# sit-out slot.
_SIT = object()
# Floater duty, for the rules that treat every floater section as one duty.
_FLOAT = object()


def plan_week(
    sections: Sequence[int],
    people: Sequence[int],
    history: Sequence[Mapping[int, int]],
    rosters: Sequence[Collection[int]] | None = None,
    following: Mapping[int, int] | None = None,
    floaters: Collection[int] = (),
    fixed: Mapping[int, int] | None = None,
) -> dict[int, int]:
    """Decide one week.

    sections  active section ids in FILL ORDER: main sections first (by their
              sort order), the floater(s) last.
    people    active person ids in roster order.
    history   recent weeks, NEWEST FIRST: history[0] is the week just before
              the one being planned, as {section_id: person_id}. A week with
              no rows is an empty mapping and still counts as a week. Rows for
              sections retired since still show that the person WORKED that
              week (they just are not a position any more); rows for people no
              longer active are ignored.
    rosters   optional, aligned with history: who was on the rotation that
              week. Someone on the roster with no row in a planned, complete
              week (filled as far as its roster allowed) sat it out; a week
              only started by hand says nothing about who it leaves out. Without rosters everyone active now is assumed
              to have been on the roster every week — fine for a stable
              roster, but it credits a newcomer with sit-outs from before they
              joined, so the router passes real rosters.
    following the week AFTER the one being planned, if it is already built
              (a week built ahead, or rebuilding a past week). Matching it
              counts as a back-to-back too — otherwise filling an empty week
              that sits before an already-built one hands everybody the same
              position two weeks running.
    floaters  the floater section ids. All floaters are one duty for the
              back-to-back rule (floating two weeks running is back-to-back
              whichever floater it was); for repeats each is its own section.
              The cycle spreads floater weeks between the mains, then sit-out
              weeks across all of them.

    fixed     {section_id: person_id} pairs decided OUTSIDE the fairness
              solve — a person pinned to a section (the newcomer on the
              training section, the supervisor who only floats). Those
              sections and people are carved out and everyone else is planned
              fairly around them; the pairs come back in the returned plan.

    Returns {section_id: person_id} for every section that gets filled.
    Sections left out are unfilled that week (the floater when short-handed).
    People left out sit the week out (only when there are more people than
    sections).
    """
    if fixed:
        pin = {s: p for s, p in fixed.items() if s in set(sections) and p in set(people)}
        if pin:
            pinned_people = set(pin.values())
            rest = plan_week(
                [s for s in sections if s not in pin],
                [p for p in people if p not in pinned_people],
                history,
                rosters,
                following=following,
                floaters=[f for f in floaters if f not in pin],
            )
            rest.update(pin)
            return rest
    week = _Week(sections, people, history, rosters, following, floaters)
    if not week.people or not week.sections:
        return {}
    best = week.solve()
    if len(week.people) > ROLLOUT_MAX_PEOPLE or len(week.people) < 2:
        return week.to_sections(best)

    # Rule 4: every assignment tied with the solver's pick on rules 1-3,
    # played forward. The solver's pick is already the best on rules 5-8, so it
    # only loses to a candidate with a strictly better future.
    top = week.top_rules(best)
    tied = [a for a in week.all_assignments() if week.top_rules(a) == top]
    if len(tied) <= 1:
        return week.to_sections(best)
    roster = set(week.people)
    later_rosters = None if rosters is None else [roster, *rosters]

    def future(a: tuple[int, ...]) -> tuple[int, int]:
        h = [week.to_sections(a), *history]
        r = later_rosters
        b2b = reps = 0
        for t in range(1, len(week.people)):
            if t == 1 and following:
                nxt_map = dict(following)
                nxt_week = _Week(sections, people, h, r, None, floaters)
                nxt = nxt_week.from_sections(nxt_map)
            else:
                nxt_week = _Week(sections, people, h, r, None, floaters)
                nxt = nxt_week.solve()
                nxt_map = nxt_week.to_sections(nxt)
            b2b += nxt_week.count(nxt, nxt_week.rule_b2b)
            reps += nxt_week.count(nxt, nxt_week.rule_repeat)
            h = [nxt_map, *h]
            r = None if r is None else [roster, *r]
        return (b2b, reps)

    best_future = future(best)
    if best_future == (0, 0):
        # Nothing can beat a clean future, and the solver's pick is already the
        # cheapest on every other rule — the steady state never looks further.
        return week.to_sections(best)
    winner = best
    for a in tied:
        if a == best:
            continue
        f = future(a)
        if f < best_future or (f == best_future and week.full_cost(a) < week.full_cost(winner)):
            if f < best_future:
                best_future, winner = f, a
            elif f == best_future:
                winner = a
    return week.to_sections(winner)


class _Week:
    """One week's inputs, the per-(person, position) rules, and the exact
    lexicographic solve. An assignment is a tuple: assignment[i] = the index
    into self.positions given to people[i]."""

    def __init__(self, sections, people, history, rosters, following, floaters):
        self.people = list(dict.fromkeys(people))
        self.sections = list(dict.fromkeys(sections))
        n = len(self.people)
        self.n = n
        self.L = n                                      # weeks in one rotation
        self.filled = self.sections[: min(n, len(self.sections))]
        self.n_off = max(0, n - len(self.sections))
        self.off_gap = (n // self.n_off) if self.n_off else 0
        self.positions: list[object] = [*self.filled] + [_SIT] * self.n_off
        active_people = set(self.people)
        active_sections = set(self.sections)
        self.floater_set = set(floaters) & active_sections
        self.history_len = len(history)

        # held[pid][k-1] = section id (a frozenset of them when a hand edit
        # left someone on two sections that week), _SIT, or None (not on the
        # roster / week not planned / worked a section that is no longer a
        # position).
        self.held: dict[int, list[object]] = {pid: [] for pid in self.people}
        for k, week in enumerate(history, start=1):
            roster = rosters[k - 1] if rosters is not None and k - 1 < len(rosters) else None
            by_person = _held_by_person(week, active_people, active_sections)
            # Only a COMPLETE week says who sat out: one filled as far as its
            # roster allowed. A week only started by hand (one cell set) says
            # nothing about the people it doesn't name.
            on_roster = sum(1 for p in self.people if roster is None or p in roster)
            complete = len(week) >= min(len(self.sections), on_roster)
            for pid in self.people:
                if pid in by_person:
                    self.held[pid].append(by_person[pid])
                elif week and complete and (roster is None or pid in roster):
                    self.held[pid].append(_SIT)
                else:
                    self.held[pid].append(None)

        self.next_week: dict[int, object] = {}
        if following:
            by_person_next = _held_by_person(following, active_people, active_sections)
            complete = sum(1 for sid in following if sid in active_sections) >= len(self.filled)
            for pid in self.people:
                if pid in by_person_next:
                    if by_person_next[pid] is not None:
                        self.next_week[pid] = by_person_next[pid]
                elif self.n_off and complete:
                    self.next_week[pid] = _SIT

        mains = [s for s in self.filled if s not in self.floater_set]
        floats = [s for s in self.filled if s in self.floater_set]
        # Sit-outs are spread LAST, across every working week (floaters
        # included), so two never land side by side while there are working
        # weeks to put between them.
        self.cycle: list[object] = _spread(_spread(mains, floats), [_SIT] * self.n_off) if n else []
        self.targets = {pid: self._target(i, pid) for i, pid in enumerate(self.people)}

        self.rules = [self.rule_b2b, self.rule_repeat, self.rule_fair_sit,
                      self.rule_off_cycle, self.rule_recency, self.rule_long_run]
        rule_max = [2, 1, self.L, 1, self.L ** 2, self.history_len]
        # Weights, bottom up: each is one more than the largest possible SUM
        # over the whole week of everything below it (n cells), so no
        # combination of lower terms can ever outvote one unit of a higher rule.
        below = max(n, 1) ** 3                          # summed tie-break < n^3
        self.weights: list[int] = []
        for m in reversed(rule_max):
            self.weights.append(below)
            below *= max(n, 1) * m + 1
        self.weights.reverse()
        # cell[j][i] = cost of people[i] taking positions[j]
        self.cell = [[self._cell(i, pid, j) for i, pid in enumerate(self.people)]
                     for j in range(len(self.positions))]
        # rules 1-3 per cell, for comparing whole assignments quickly
        self.top = [[tuple(r(pid, self.positions[j]) for r in self.rules[:3]) for pid in self.people]
                    for j in range(len(self.positions))]

    # ---- position comparisons ---------------------------------------------
    def _duty(self, pos):
        return _FLOAT if pos in self.floater_set else pos

    def _same(self, a, b) -> bool:
        """Same position for the back-to-back rule (floaters = one duty). `a`
        is the held side: a set of sections matches any of them."""
        if a is None or b is None:
            return False
        if isinstance(a, frozenset):
            return any(self._same(x, b) for x in a)
        a, b = self._duty(a), self._duty(b)
        if a in (_SIT, _FLOAT) or b in (_SIT, _FLOAT):
            return a is b
        return a == b

    @staticmethod
    def _exact(a, b) -> bool:
        """Same position exactly (floaters told apart) — for repeats, the
        cycle, recency, balance. `a` is the held side, as in _same."""
        if a is None or b is None:
            return False
        if isinstance(a, frozenset):
            return any(_Week._exact(x, b) for x in a)
        if a is _SIT or b is _SIT:
            return a is b
        return a == b

    def _target(self, i: int, pid: int) -> object:
        # The phase whose last L steps best explain this person's recent
        # weeks. No evidence in the last cycle -> fit their whole history (the
        # cycle keeps turning through a gap). No evidence at all -> roster
        # order, so a brand-new rotation starts person i -> cycle[i]. (The
        # router pads history with empty weeks, so len(history) is NOT a count
        # of weeks the cycle ran.)
        L, held = self.L, self.held[pid]
        seq = held[:L]
        if not any(h is not None for h in seq):
            seq = held
        has_any = any(h is not None for h in held)
        default = (i + self.history_len) % L if has_any else i % L
        best_phase, best_score = default, -1
        for step in range(L):
            phi = (default + step) % L
            score = sum(1 for k, h in enumerate(seq, start=1) if self._exact(h, self.cycle[(phi - k) % L]))
            if score > best_score:
                best_phase, best_score = phi, score
        return self.cycle[best_phase]

    # ---- the rules (per person, position) ----------------------------------
    def rule_b2b(self, pid, pos) -> int:
        held = self.held[pid]
        before = bool(held) and self._same(held[0], pos)
        after = pid in self.next_week and self._same(self.next_week[pid], pos)
        return int(before) + int(after)

    def rule_repeat(self, pid, pos) -> int:
        if pos is _SIT:
            k = next((k for k, h in enumerate(self.held[pid], start=1) if h is _SIT), None)
            return int(k is not None and k < self.off_gap)
        # Each floater is its own section here: the cycle holds every filled
        # floater once per rotation, so pooling them made the second one a
        # "repeat" for everybody and pinned people to one floater. Floater
        # duty stays one duty for the back-to-back rule (rule_b2b, _same).
        k = next((k for k, h in enumerate(self.held[pid], start=1) if self._exact(h, pos)), None)
        return int(k is not None and k < self.L)

    def rule_fair_sit(self, pid, pos) -> int:
        if pos is not _SIT:
            return 0
        # Over the person's last L PLANNED weeks: an empty week inside the
        # window must not hide the sit-out just before it, or a week built
        # ahead of an empty one steals that week's layout.
        planned = [h for h in self.held[pid] if h is not None][: self.L]
        return sum(1 for h in planned if h is _SIT)

    def rule_off_cycle(self, pid, pos) -> int:
        return 0 if self._exact(self.targets[pid], pos) else 1

    def rule_recency(self, pid, pos) -> int:
        k = next((k for k, h in enumerate(self.held[pid], start=1) if self._exact(h, pos)), None)
        return 0 if k is None or k > self.L else (self.L + 1 - k) ** 2

    def rule_long_run(self, pid, pos) -> int:
        return sum(1 for h in self.held[pid] if self._exact(h, pos))

    def _cell(self, i: int, pid: int, j: int) -> int:
        pos = self.positions[j]
        c = ((j - i) % self.n) * self.n + i            # roster i -> position i on ties
        for w, rule in zip(self.weights, self.rules):
            c += w * rule(pid, pos)
        return c

    # ---- assignments -------------------------------------------------------
    def solve(self) -> tuple[int, ...]:
        match = _min_cost_assignment(self.cell)        # position index -> person index
        a = [0] * self.n
        for j, i in enumerate(match):
            a[i] = j
        return tuple(a)

    def all_assignments(self):
        """Every distinct assignment (sit-out slots are interchangeable)."""
        seen = set()
        for perm in itertools.permutations(range(self.n)):
            key = tuple(j if self.positions[j] is not _SIT else -1 for j in perm)
            if key in seen:
                continue
            seen.add(key)
            yield tuple(perm)

    def count(self, a: tuple[int, ...], rule) -> int:
        return sum(rule(pid, self.positions[a[i]]) for i, pid in enumerate(self.people))

    def top_rules(self, a: tuple[int, ...]) -> tuple[int, int, int]:
        b2b = rep = sit = 0
        for i in range(self.n):
            x, y, z = self.top[a[i]][i]
            b2b += x; rep += y; sit += z
        return (b2b, rep, sit)

    def full_cost(self, a: tuple[int, ...]) -> int:
        return sum(self.cell[a[i]][i] for i in range(self.n))

    def to_sections(self, a: tuple[int, ...]) -> dict[int, int]:
        return {self.positions[a[i]]: pid for i, pid in enumerate(self.people)  # type: ignore[misc]
                if self.positions[a[i]] is not _SIT}

    def from_sections(self, week: Mapping[int, int]) -> tuple[int, ...]:
        """An existing week (e.g. the already-built following week) as an
        assignment, for counting its rules. People with no row sit out."""
        index = {pos: j for j, pos in enumerate(self.positions) if pos is not _SIT}
        sits = [j for j, pos in enumerate(self.positions) if pos is _SIT]
        a = []
        for pid in self.people:
            sid = next((s for s, p in week.items() if p == pid), None)
            if sid in index:
                a.append(index.pop(sid))
            elif sits:
                a.append(sits.pop())
            else:
                a.append(index.popitem()[1] if index else 0)
        return tuple(a)


def _held_by_person(week: Mapping[int, int], active_people: set, active_sections: set) -> dict[int, object]:
    """{person: what they held that week}: a section id; a frozenset when a
    hand edit left them on two or more sections (every one counts as held,
    whatever order the rows came back in); or None when every section they
    held has been retired since."""
    out: dict[int, set] = {}
    for sid, pid in week.items():
        if pid in active_people:
            out.setdefault(pid, set())
            if sid in active_sections:
                out[pid].add(sid)
    return {
        pid: (None if not s else next(iter(s)) if len(s) == 1 else frozenset(s))
        for pid, s in out.items()
    }


def _spread(base: list[object], extra: list[object]) -> list[object]:
    """base with extra's items spread as evenly as possible through it
    (Bresenham), both keeping their own order."""
    total = len(base) + len(extra)
    if not extra:
        return list(base)
    out: list[object] = []
    bi = ei = 0
    for i in range(total):
        if ei < len(extra) and ((i + 1) * len(extra)) // total > (i * len(extra)) // total:
            out.append(extra[ei]); ei += 1
        else:
            out.append(base[bi]); bi += 1
    return out


def _min_cost_assignment(cost: list[list[int]]) -> list[int]:
    """Exact minimum-cost assignment (Hungarian / Kuhn-Munkres with potentials).

    cost is n x m with n <= m; returns, for each row, the column it gets. Plain
    integers throughout, so the optimum is exact and repeatable.
    """
    n = len(cost)
    m = len(cost[0]) if n else 0
    if n == 0:
        return []
    # An integer "infinity" above any reachable cost, so the whole solve stays
    # in exact integers however large the rule weights grow.
    INF = (1 + max((abs(c) for row in cost for c in row), default=0)) << 32
    u = [0] * (n + 1)
    v = [0] * (m + 1)
    p = [0] * (m + 1)      # p[j] = row matched to column j (1-based), 0 = free
    way = [0] * (m + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [INF] * (m + 1)
        used = [False] * (m + 1)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = INF
            j1 = 0
            for j in range(1, m + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j] = cur
                        way[j] = j0
                    if minv[j] < delta:
                        delta = minv[j]
                        j1 = j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    out = [0] * n
    for j in range(1, m + 1):
        if p[j]:
            out[p[j] - 1] = j - 1
    return out
