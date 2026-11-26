# When the AI reruns the same command again and again

Some AI turns go wrong in a quiet way: after every small edit the AI runs the
same slow command again (usually a test file or the whole test suite), so the
turn spends most of its time waiting. Vibe64 notices this by itself and tells
both the AI and you. It never stops, slows or refuses a command.

## What counts

Vibe64 counts the shell commands of each Main chat turn: the turn for a
message you send, each step of Auto, and each pass of a plan. Two commands
count as the same when their text is the same (spaces aside). A turn has
clearly gone wrong when:

- one command has run 5 or more times, taking 5 minutes or more in all; or
- commands that ran more than once have taken 15 minutes or more in all.

These mark a turn that is clearly broken. They are not targets: a turn well
below them can still repeat more than it needs to. Quick commands such as
`git status` never add up to these. Each turn starts again from nothing, and
temporary chats' commands are not counted.

## What the AI is told

The first time a turn crosses one of these, its AI gets one note from Vibe64,
in the chat as Vibe64's message, never as yours. For example:

> Vibe64 noticed repeated commands in this turn: `npm test -- tests/server/shop.test.js`
> has run 5 times (15 min in all), and commands run more than once have taken
> 18 min of this turn's 22 min of commands. Please batch your changes: make the
> related edits together, run the narrowest test that checks them while you
> iterate, and run the full set once at the end. This notice comes once per
> turn; nothing is stopped or slowed.

It comes once per turn, however often the command runs again. If the turn has
already ended, nothing is sent.

## What you see when the turn ends

When a turn that crossed the line ends, Main chat shows a short summary from
Vibe64 under it, with the turn's final numbers. For example:

> This turn reran commands far more than its work needed:
> `npm test -- tests/server/shop.test.js` 7 times (28 min), `npm run lint`
> 3 times (6 min). Commands run more than once took 34 min of the turn's 40 min
> of commands. Vibe64 told the AI once to batch its changes, run the narrowest
> test while iterating and run the full set once at the end.

Commands are shortened, and anything that looks like a password, token or key
is shown as `[redacted]`.

## What to do

Nothing is required: the work carries on. If the same turn keeps repeating
after the note, you can:

- while it works, add an instruction through **Steer**, for example "Stop
  rerunning the tests after each edit: make the remaining changes, then run
  the affected test once" (steering never stops the running command);
- choose **Stop** to end the turn, then type your instructions and select
  **Send**.

Colleague can explain a summary and suggest what to tell the AI. It can't
change what counts, turn the notes off or rerun anything for you.
