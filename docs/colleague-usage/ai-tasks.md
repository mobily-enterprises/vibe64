# Fix a problem with AI in the AI task window

When Vibe64 offers **Fix it with AI** on an Update, Save, workspace preparation,
preview sign-in or project setup problem, the whole fix happens in
one window: the problem, the conversation with the AI, what Vibe64 is doing, and the
result. Starting, adopting or inspecting a project from its setup screen, and
creating or reviewing the Database's Data overview, use the same window. So do the
tasks Colleague runs for you and its reviews, and a page's AI refresh, which starts
by itself on its schedule ([Keep a page up to date](pages.md#keep-a-page-up-to-date)). You close it once the task is
**Done** or **Not done**. It can't end any other way.

The window holds only tasks that Vibe64 or Colleague start. A conversation of your
own with the AI is a temporary chat: open **Temporary AI** in the session header (or
in **Session actions** when the header is narrow). See
[Work in a temporary chat](temporary-chats.md). An AI task never appears among the
temporary chat tabs.

## Open it

Choose **Fix it with AI** on the Update, Save or workspace preparation notice, on the
Update error in Repository, under a failed identity in Preview's identity menu, or on
**Project setup needs attention**. On the setup
screen, **Start through conversation**, **Set up project** and **Inspect it for me**
open it too, and so do **Create with AI**, **Review with AI** and **Review N ungrouped
tables** in the Database's Overview ([Browse a project's Database](database.md)).
The button says **Opening…** while it starts, **Being fixed… →** while
a fix is running, and **See result →** when a fix has ended and waits for you. In
those last two states it opens the same window again; it never starts a second fix.

On a phone or a short screen the window fills the screen. Otherwise it is a dialog
with a fixed height, so it does not jump as its content changes. Everything works
the same at every size.

## What the window shows

The header names the fix and says, in one line, what is happening now. Below it,
the problem stays in view. Choose **Details** to read all of it. Names in the
problem, such as a Stack's `## Deployment` section, show as code, as they do in
Chat; hover the problem to see it as written.

Two views sit under the problem, and only one shows at a time:

- **Progress** lists the steps, the attempt, and an activity list. The steps are:

  | Fix | The AI's step | Vibe64's step |
  | --- | --- | --- |
  | Update | **The AI repairs the conflicts** | **Vibe64 runs Update** |
  | Save | **The AI repairs what stopped Save** | **Vibe64 runs Save** |
  | Workspace preparation | **The AI repairs the workspace** | **Vibe64 prepares the workspace** |
  | Preview sign-in | **The AI repairs the app's seed** | **Vibe64 signs in as this identity** |
  | Project setup | **The AI sets up the project** | **Vibe64 inspects the project** |
  | Data overview | **The AI groups the tables** | **Vibe64 reads the overview back** |
  | Colleague's tasks and reviews | **The AI works on the request** | **You finish the task** |

  Choose **Update output**, **Save output** or **Preparation output** to read what
  the run printed.

  A fix whose own check runs several long steps names the step it is on in the
  header's line, beside how long that step has run, counting up each second, such
  as **Checking the build: Install dependencies · 2 min**. Under the steps, Progress then
  shows the newest line that step printed. A step whose time keeps counting is
  still working, however quiet it is; when the check ends, the line shows the
  outcome as before.
- **Chat** is the conversation with the AI. A dot on **Chat** means the AI is waiting
  for your answer.

The window opens on **Chat** when the AI asked you something or you have to decide
how the fix ends, and on **Progress** otherwise. It never switches view by itself
after that, so what you are reading stays put.

You can write to the AI while it works. Your message joins the running fix.

## Chat

Chat's message box works like Main chat's. The round Send arrow sends. While the AI is
working, the diagonal arrow sends guidance to its running turn, and the square **Stop**
interrupts that turn without ending the task. While a message is being delivered you can
type and send another; it shows **Pending** until the earlier delivery settles. You can
attach files, a Preview screenshot, or Preview's console and network diagnostics. They
belong to this task's conversation and are deleted when you close it. Goals are not
offered in an AI task. The controls are the same in narrow layouts.

Guidance sent to a working Claude turn does not interrupt it: Claude moves its current
command to the background, where it keeps running, and reads the guidance within
moments. This includes a repair that changes the project's Genesis files while it works:
the message joins the running repair, and the changed project guidance applies from its
next idle turn. Output already shown stays attached to its original request, and the
follow-up response belongs to the new request, also after reload. **Still working ·
waiting on background commands…** means the answer is shown but a background command
Claude started is still running, so the turn is still working and **Stop** still ends it;
a later follow-up reply appears after the answer without replacing it. Completed replies and progress updates are saved about a second after they
finish, even while nobody has the window open, so other viewers and a later reopen see
them with their actual timing.

After **Stop** confirms a Claude reply has stopped, text already shown remains under
**Show all … progress updates** on its original request. It is an interrupted partial
reply, not a completed answer. It remains after reload, is not replayed as a new answer
and is not doubled when Claude saved more of it while Stop was finishing. Claude's
internal no-response placeholder after Stop or a model change is not an AI reply; actual
replies and provider errors stay visible, even when their wording is similar.

Replies show their recorded AI and model, while streaming and in reopened history. Hover
the label to see its provider. An older reply without a recorded selection says **agent**
rather than claiming today's choice.

**Chat mode**, the icon inside the message box, offers **Fix it with AI**, the model AI
setup chose for fixes (it may run in a different tool from Main chat), and **Choose
model**, which opens **Orchestrator**, **Model** and **Thinking**. Select an available
connection and model, then **Apply**. The next message uses that choice with the
conversation's history so far; earlier replies keep their labels, and Main chat's
selection is unchanged. Only available models can be selected. Auto is Main chat only.

While Save or Update changes the session's source, the task's messages stay readable and
you can keep typing. The draft saves on its own and stays after reload; its saving,
saved or error indicator follows that draft only. A failed draft save keeps your text,
but don't count on it surviving a reload until it saves. A model choice on its own saves
for the next turn; a failed one stays pending and its error clears once it saves.
Sending, changing attachments, stopping and closing wait for Save or Update to finish. If
one of them says another operation is starting, try again once it has settled, and don't
resend a message whose delivery is uncertain.

Every open tab and every member viewing the session sees the same conversation and
progress. A tab that lost its connection catches up when it reconnects, and **AI is
working…** clears everywhere when the reply arrives. **Hide** keeps the draft and the
settings you just changed.

## Hand a merge repair to another model

**Fix it with AI** for an Update conflict starts on the Fix it with AI model and sends the
repair instructions once. Main chat's history is unchanged. To hand the repair to Codex:

1. If the AI is working, press **Stop** in **Chat** and wait for it to stop.
2. Open **Chat mode** and choose **Choose model**.
3. Select **Codex**, the model and thinking level, then **Apply**.
4. Send a follow-up asking it to inspect the current edits and continue the repair.

The repair instructions, messages and work already in the session remain. A model change
does not undo edits or prove the merge correct: Vibe64 still runs Update when the AI says
it has finished. If the repair is already complete, **Review resolved conflicts** (in the
footer, or on the Update error without opening the window) lists the files; then choose
**Conflicts resolved — apply Update**. This also works after edits made in
Main chat, with no further AI turn. See
[Apply an Update after resolving conflicts](github-work.md#apply-an-update-after-resolving-conflicts).

## Repairs check the saved version first

Every **Fix it with AI** turn tells the AI whether this session is behind its saved
version and lists the incoming versions, read again for each message. Before it changes
dependencies or ports code, the AI checks whether the saved version already contains the
change; if it does, the change arrives with Update and is not redone in the session.

When local work is superseded by the saved version, such as a stale or partial dependency
bump that the saved version completes, the repair takes the saved version and says so in
one sentence. It does not ask you to choose between the versions, because Vibe64's
checkpoint keeps your original. It asks only about real product decisions.

While the session's Update has failed, is running or is waiting, Update is the one repair
for the session: a project setup or workspace preparation repair tells you the session
must be brought up to date first, then stops. Fix Update first (see
[Project setup waits for Update](workspace-preparation.md#project-setup-waits-for-update)).
After that, Vibe64 checks Update again, and setup is checked again against the updated
session.

## When Vibe64 needs you

A footer appears only when something is waiting for you, and it offers exactly what
can be done next.

| The window says | What to do |
| --- | --- |
| The AI needs your answer | **Answer** in Chat. |
| Your turn (Colleague's task) | Write more in Chat, or **Finish** when it's done. |
| The AI could not finish this | **Open chat** to help it, or **End as not done**. |
| The AI stopped without saying it finished | **Check now**, or **Open chat**. |
| Stopped. Tell the AI what to do next. | **Continue**, or **Open chat**. |
| The AI account can't run this right now | **Open AI setup**, then **Continue**. Nothing is lost. |
| The AI ran into an error | **Continue**, or **Open chat**. |
| Vibe64 restarted while the AI was working | **Continue**. A lost turn never restarts by itself. |
| Vibe64 couldn't confirm the result | **Check now**. |
| The check failed. Your unsent message is waiting. | **Open chat** and send it or clear it. |
| What Update said, after three failed checks | **Check now**, **Open chat** or **Review resolved conflicts**. |
| What Save said, after three failed checks | **Check now** or **Open chat**. |
| Save needs your review of where it goes | Choose **Save** and review it, then **Check now**. |
| Save waits for the main chat's AI to finish | **Wait for the AI**, or **Save now** to include its unfinished changes. |
| Preview isn't running | Start Preview, then **Check now**. |
| This preview can't switch identity | Restart Preview, then **Check now**. |
| Project setup waits for Update | Fix Update first, then **Check now**. |
| The data overview could not be read | Check the database is available, then **Check now**. |

When a repair is ready while the main chat's AI is still working, Fix Update runs
Update straight away: Update and Save can run while the AI works. Fix Save asks
first, because Save would include the AI's unfinished changes: the window names the
main chat and the time its AI started working. It also waits between the steps of
the main chat's work, such as an Auto review, so the time shown is then when the wait
began. **Wait for the AI** returns you to the main chat, and Vibe64 saves by itself as
soon as that work ends; **Save now** saves at once, unfinished changes included. When the main chat is idle, or
you stopped its AI, Fix Save saves straight away with no click. Both still wait while another Save, Update or preparation holds
the session.

**Review resolved conflicts** opens the same review as the Update error (see
[Apply an Update after resolving conflicts](github-work.md#apply-an-update-after-resolving-conflicts)).
When you confirm it, the window runs Update as this fix's own check.

## How a fix ends

**Done** is proved, never assumed. When the AI says it has finished, Vibe64 runs
Update, Save or workspace preparation again, or signs in as the identity, by itself,
on the server, whether or not anyone is watching. You never press another button to
finish a fix: a fixed Save pushes the work. A fixed sign-in proves the app accepts the
identity; choose it again in Preview's identity menu to sign Preview in. Project setup is Done once Vibe64's own inspection needs nothing. The Data
overview is Done once Vibe64 reads it back valid against the refreshed schema, with every
table reviewed for a whole or new-tables review; Overview then reloads by itself. If the run
still fails, the fix goes back to the same conversation with what failed, up to three
attempts. Work you saved yourself meanwhile counts: when nothing is left to save,
the Save fix is Done.

Nothing in Vibe64 can prove that Colleague's request is done, so a Colleague task waits
after each of the AI's turns: write more, or choose **Finish** to end it **Done**.
Colleague or you can finish it.

**Not done** is decided by a person: you choose **Cancel** or **End as not done**, or
the session is archived while the fix is open. Vibe64 never gives up on its own.

The result replaces the views. It shows the problem, what happened, what the AI did
and, on **Not done**, what's next. **See the conversation** reads the whole chat;
**Show the result** returns. **Close** is the only way out, and closing changes
nothing in the session. An ended fix does not get in the way: starting a new task
closes it.

## Leave and come back

**Hide** (**Esc** on a keyboard, or the browser's Back) only puts the window
away. The fix keeps running on the server, and a chip beside
the Colleague button shows how it is going: the fix's name, **Needs you**, **Done**
or **Not done**. On a phone the chip is an icon. Choose the chip, or the button on
the notice, to return. A reload or another device returns to the same fix, and the
address of the window can be shared with another member of the project. Clicking
outside a dialog does nothing.

If a fix ends while the window is hidden, a message offers **See result**.

## Cancel

**Cancel** asks once, in the footer: the AI stops, and anything it has changed stays
in the session. **Cancel fix** confirms; **Keep going** carries on. Cancelling always
works. The button then says **Cancelling…** until Vibe64 confirms it.

A Cancel while Vibe64 runs Update or workspace preparation for the fix stops that
run within a few seconds, and the fix ends **Not done** once Vibe64 confirms it stopped:

- A cancelled Update leaves the session exactly as it was. Update's activity card
  says it needs attention: "Update was cancelled before it changed this session."
  **Retry** runs Update again, and **Fix it with AI** picks up the conflicts the
  cancelled run was resuming.
  Once Update has started applying its result to the session's files it finishes
  instead; the fix then ends **Done** with "This finished before the cancel took
  effect."
- A cancelled preparation stops the step that was running and runs no later step.
  The preparation card shows **Workspace preparation failed** with "Workspace
  preparation was cancelled. Prepare workspace runs every step again.", and its
  output marks that step **Cancelled**. **Prepare workspace** or **Retry** runs
  every step again. Preparing connected repositories and upgrading an older project's
  format finish before Cancel takes effect.

Vibe64's other checks (Save, signing in, inspecting the
project, reading the overview) can't be interrupted, so a Cancel during one says
so and the task ends as soon as that run finishes.

## One at a time

A session has one AI task at a time, whoever started it. Your temporary chats
don't count toward it. A page's AI refresh counts: while one runs, **Fix it with AI**
says "A page refresh is running in this session. Wait for it, or cancel it.", and a
refresh due while another task is open waits for its next time. A refresh doesn't
hold Save or Update. Members see the same window
live, and any of them can answer, Cancel or Close. While a fix is running, Vibe64
refuses Save, Update and **Prepare workspace** with a
message; try them again when it ends. While Update is failed, workspace preparation's fix waits for Update's: Update
prepares the workspace again itself. Connecting,
disconnecting or switching an AI account never stops or waits on a running fix.

Archiving a session with a fix running warns you first, and ends the fix as **Not
done**. Its ended tasks stay in the archive with their saved history, and their AI
conversations are cleaned up with the main chat's, as for temporary chats
([archived AI history](coding-agent-history.md#attachments-and-saved-history)).
Renewing does the same for the old session's tasks: the fresh session starts
without them.

Colleague can explain this window and what its state means. It doesn't start, answer
or end a fix from a notice; choose those controls yourself.

When you ask Colleague to, it can start its own task, read how a task is going, open
it in this window, and cancel, finish or close it. A Colleague task runs Colleague's
request in its own conversation and ends when Colleague or you choose **Finish**. When
you agree a project setup request with Colleague (start, inspect, adopt or repair), it
starts that as the session's **Project setup** task, and Vibe64 inspects the project
when the AI finishes, exactly as when you start it yourself. A Colleague assignment's
review is the session's AI task while the assignment runs; it ends when the work is
ready or cancelled. Because a session has one AI task at a time, Colleague gets the same
refusal you would and tells you which task to finish first. When you ask for a chat of
your own, Colleague creates a temporary chat instead of a task
([Work in a temporary chat](temporary-chats.md#what-colleague-can-do)).

## Recover a lost delivery confirmation

If the AI finishes just as you send guidance, a confirmed rejection before delivery lets
that same message continue once as a new request. Stop, cancellation and uncertain
delivery never trigger that automatic retry. An earlier answer stays attached to its
original message even when a later message is rejected; the rejected message and its
recovery controls stay visible.

If a send fails before Vibe64 accepts it, **Retry** sends the original message with its
original settings and files. Anything you typed or attached afterwards stays in the
message box; accepted files leave it.

**Retry** on a message first checks whether that exact message reached the AI. If it did,
nothing is sent again. If the AI proves it never received it, Retry sends it once with its
original settings; while delivery is still unknown, nothing is sent. If the connection
can't read the AI's receipt, retry the check after reconnecting. **Cancel** is always
available on a pending, unconfirmed or failed message, including while **Checking…** is
shown (it ends that check). The message shows **Cancelling…** until the server confirms,
then leaves the conversation for good, and the server stops any work it started. If the
server can't be reached, the message stays with **Couldn't reach the server — Cancel
again**, and the window retries after reconnecting. If the AI had already received it, its
answer still appears. A failed message that never reached the AI, for example because the
task's conversation could not start, has nothing on the server to cancel: **Cancel**
removes it at once, and **Edit** returns its text to the message box.

**Close** removes the task only after its AI work and attachments are cleaned up. If you
used more than one AI in the task, Close cleans up each one's conversation. A failed Close
can be retried; the retry continues the unfinished cleanup without repeating what was
already removed. Vibe64 also retries it by itself after that AI's next turn in the same
session, and before the session is archived or renewed; if it still fails then, archiving
or renewal stops with the reason and the session stays open.

During an Update repair, **Checking Update…** means the repository operation is not yet
confirmed. After a disconnect or reload an uncertain result shows as unconfirmed, not as
success or failure; only its confirmed result clears it.

## Typing and message order

Typing in Chat tells other viewers you are typing, in one small update at most every five
seconds, without sending your draft; the indicator expires within ten seconds of the last
update. Prompt suggestions wait for a five-second typing pause and at least thirty seconds
between suggestions; refocusing doesn't generate new ones.

Messages and replies appear together in time order, including guidance sent while the AI
is working, on desktop and phone. Reopening or reloading shows the same history without
resending anything.

Colleague can explain any of this. Choosing a model, stopping work and closing a task stay
your actions in the window, or separate requests to Colleague.
