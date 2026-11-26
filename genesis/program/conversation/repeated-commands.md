# Repeated commands in a turn

An AI that reruns the same slow command after every small edit spends most of
its turn waiting. The editor counts each Main turn's own shell commands and,
when the turn has clearly gone wrong, tells its AI once to batch its changes,
and shows the person the same numbers when the turn ends. It never stops,
slows or refuses a command.

## Sources

- Main: `packages/vibe64-terminals/src/server/agentCommandRepeats.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `packages/vibe64-terminals/src/server/serviceCommandServices.js`
- `packages/vibe64-terminals/src/server/serviceTurnPublication.js`
- `packages/vibe64-terminals/src/server/mainChatNote.js`
- `tests/server/agentCommandRepeats.unit.test.js`
- `docs/colleague-usage/repeated-commands.md`

## Public contract

A Main turn whose own shell commands cross `COMMAND_REPEAT_LIMITS` gets one
Vibe64 note to its AI while it runs, and its chat gets one system row with the
turn's numbers when it ends. Counting never stops, slows or refuses a command,
never changes its answer, exit code or timing, and keeps nothing beyond the
running turn.

## What is counted

Every shell command an AI runs reaches the session command wrapper
(`agentSessionCommand.run`). Once a command that ran has answered, the
service counts it, off the command's path (`setImmediate`), in the turn named
by Main chat's routed request (`assistant_routing_request` while its status is
`working`: a message's turn, an Auto step, a plan's pass). A command refused
before it started, or one run while no Main chat request works (a temporary
chat's, say), is not counted. Commands are matched by their text with only
whitespace collapsed; nothing guesses what a test is.

The count is in memory only, one turn per session: a turn with another id
starts it again, a Main turn's end (`serviceTurnPublication`, every engine's
turn-idle reason) ends it, and so do the session's close and a restart. Nothing
is read back from logs or stored history. A turn holds at most 1,000 different
command texts (their time still counts), each as a hash and a 160-character
excerpt masked by `sanitizeLogText` plus any long token-looking word.

## The line

`COMMAND_REPEAT_LIMITS` marks what is clearly broken, not a target:

- one command text run 5 or more times, with 5 minutes or more in all (so cheap
  repeats such as `git status` never count); or
- commands run more than once taking 15 minutes or more in all, every run of
  each counted.

## What the AI and the person see

The run that crosses the line sends one note per turn to Main chat's running
turn through `noteMainChat`, the steer Update, Save and a planned restart use,
shown as Vibe64's note and acting for the person whose request runs (when
they may still use the project). It names the most costly repeated command,
its runs and minutes, the repeated minutes and the turn's minutes of commands,
and the rule: batch the changes, run the narrowest test while iterating, run
the full set once at the end. A turn that ended meanwhile refuses the steer.

When a Main turn that crossed the line ends, its chat gets one system row
(`vibe64-command-repeats:<turnId>`) with the turn's final numbers and up to
three repeated commands, the most time first, published as an `upsert-turn`
patch.

A failing count, note or row is only logged
(`vibe64.agent_session_command.repeats_failed`,
`vibe64.agent_session_command.repeats_summary_failed`); the command's answer,
exit code and timing never depend on it.
