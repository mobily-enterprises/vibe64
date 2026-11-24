---
name: genesis-master-pass
description: Run the project's passes deeply, one after another, through an explicitly requested Master pass over the whole app or the changes since its last completed run, every pass or the ones named, each as that pass's own Deep run, committed and tested before the next starts, with a ledger that lets an interrupted Master pass continue and one combined report. Use when asked for a Master pass, to run every pass, or to run several passes deeply in turn.
---

# Genesis Master pass

Run the selected passes deeply, one after another, so the software comes out of
each one committed and tested before the next starts. A Master pass is
explicit: never run it merely because implementation finished.

Resolve the invocation before running the first Genesis operation. Do not use a
Genesis operation or `genesis --version` as an availability probe.

1. Read the repository-root `package.json`. Only when that
   manifest's `name` is `genesis-compiler` is the repository Genesis's own
   source. There, invoke every Genesis CLI operation with
   `npm exec --no -- genesis <arguments>`, which runs the repository's own
   Genesis without fetching another package. If it is not installed, report
   that the repository's dependencies are not prepared; do not fall back to
   another Genesis version.
2. Otherwise, do not try `npm exec`. Run `command -v genesis` (or the current
   shell's equivalent `PATH` lookup). When it resolves an executable, invoke
   `genesis <arguments>` directly; inside Vibe64 that is the platform's Genesis.
   A `genesis-compiler` that the project's `package.json` declares does not
   serve the project: it belongs to the project's own scripts, so never run it
   through `npm exec`, `npx` or `node_modules/.bin`.
3. When neither source is available, stop and report that Genesis is
   unavailable. Never install or update Genesis, or add it to the project's
   dependencies, merely to satisfy a workflow instruction.

Successful invocation resolution is routine. Do not narrate which Genesis was
selected, and never describe direct `PATH` use as a fallback. Mention how the
invocation was selected only when resolution fails or the user explicitly asks.

Follow the configured Collaboration approach for user-facing updates, including
its technical depth and response length. Report concrete progress,
findings, or blockers; do not announce that you are following guidance.

## Load the effective project instructions once

A Master pass request may arrive as a complete Genesis-generated prompt or as a
direct request such as `Master pass` or `Master pass (security, data, deslop)
the whole app.`

If the current task already contains `GENESIS CONTEXT` whose task is
`master-pass`, continue with it directly. Do not generate another prompt.

Otherwise, run the Genesis `prompt --task master-pass` operation once using the
invocation rule above. For a bare `Master pass`, pass no request argument: it
runs every pass the project offers over the whole app. When the user names
passes, pass `Master pass (<their names>) the whole app.` with the names
separated by commas; a pass's id or title works, with or without "pass". When
the user asks for the changes since the last completed Master pass, pass that
run's request from `genesis inspect passes --json` exactly. Genesis refuses a
name it offers no pass for and names the passes it does; tell the user. Treat
the printed prompt as the instructions for this same turn and do not generate
it again.

## What the Master pass adds, and what it does not

The prompt's `MASTER PASS` section lists the passes to run, in order, each with
the exact request of its own Deep run. Run them in that order, whatever order
they were named in: the review first, so every later pass starts from tested
work, then security, so later passes build on the access it fixes, and Deslop
last, so it cleans up after what the others changed. If you see a reason in
this project for another order, say so in the report rather than changing it.

Each pass runs as that pass's own Deep run, from its own prompt. Its `DEEP RUN`
section says how the checklist, evidence, chunks, agents, commits and report
work, and its skill says what its lens adds and what it may change. The Master
pass never restates, shortens or loosens that guidance; it adds only the order,
the checkpoint between passes, the ledger and the combined report.

## Keep the Master ledger

Before the first pass, write the Master ledger at the path the `MASTER PASS`
section names. It lives in Git's own directory, outside the project's tracked
files, so an interrupted Master pass finds it again. Record the request, the
commit it starts from, and each listed pass with its status (to do, running,
questions, done or skipped), the path of its checklist (the one its `DEEP RUN`
names), its commits and its checklist count. Update it as each pass starts and
finishes.

When a ledger for the same request is already there and not finished, continue
from it: passes marked done stay done, and a pass marked running or questions
continues its own checklist from its first unticked item. Any other ledger is
replaced.

## Run each pass

For each listed pass, in order:

1. Mark it running in the ledger.
2. Generate its prompt with the Genesis `prompt` operation and the exact
   request listed for it, for example `prompt --task security-pass "Security
   pass the whole app deeply."`, and follow that prompt in full as this pass's
   instructions, through its own `PASS RECORD` step, which records the pass on
   its own so its next run since its last completed one starts there.
3. Where the host can run several agents, the pass gives its chunks to them as
   its `DEEP RUN` says, as many as the host's test budget and limits allow, and
   you coordinate them. The passes themselves run one after another, never at
   the same time, because each one starts from the tree the last one committed.
4. Checkpoint before the next pass starts: every change of this pass is
   committed, in small commits of one checklist item or concern each with
   messages that say what changed and why; nothing is left uncommitted; and the
   pass's final whole-suite run passed on the committed tree. Record its
   commits and checklist count in the ledger and mark it done.

Each pass ends as its `PASS REPORT` says: finished, or with questions for the
person. A pass with questions, including a blocker such as failing checks it
cannot fix, stops the Master pass there: mark it questions in the ledger,
report its questions, and do not start the next pass. Once they are answered,
it continues from its checklist and finishes before the next pass starts. When
the person said to pick the recommendation, each pass picks it, records the
choice and finishes, and the Master pass goes on.

Skip a pass that does not apply to this software, such as the UI or identity
pass where the software has no screens, and write the reason in the ledger and
the report. Never skip a pass because it is long or hard.

## Record and report

Once every listed pass is done or skipped, take the prompt's `PASS RECORD` step:
the Genesis `passes done master-pass <pass id...>` operation, naming the passes
it ran and leaving out those it skipped, records the Master pass in
`genesis/passes-added.json`; commit that change as its last commit, so nothing is
left uncommitted and its next run since the last one starts there.

End with one combined report. Open with the ending reached (finished, or the
questions of the pass where it stopped), the passes run and skipped, and how the
work was split across agents (or that it ran as one agent). Then, for each pass
in order: its checklist count and how many ticks rest on each kind of evidence,
what changed, its commits, its unticked items and the choices it made for the
person.
A pass that changes behaviour on purpose, such as the security, data or
quality pass, states plainly what now behaves differently; a pass that keeps
behaviour, such as Deslop, states that behaviour is unchanged and how that was
proven. For a run since the last Master pass, say which files each pass read in
full and which it only searched against the whole app. Close with the final
whole-suite run on the committed tree, then one "Outside this scope" list for
every pass.
