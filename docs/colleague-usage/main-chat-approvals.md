# Main chat messages that wait for the owner's approval

A project's Main chat always runs on the workspace owner's AI. When a team
member writes in Main chat, the message does not reach the assistant straight
away: it waits in **Messages for approval** until the owner approves, edits or
declines it. The owner's own messages are sent as usual and never wait.

Temporary chats, Colleague and the other assistants a member uses run on that
member's own team setup; only Main chat waits for approval.

A team member's own lesson is the exception. A practice project is private to
its learner, so its Main chat runs on the team setup and the member's messages
(and the lesson's **Do it for me** prompts) are sent straight away, with no
approval. The composer then reads "Message your lesson's AI — *model* (team
AI)". See **Lessons** in [Team AI access](team-ai-access.md). The owner's own
lessons are unchanged. Messages sent by
another session (project messages) are not person requests and never wait.

## Send a message as a team member

1. Open the project's coding session. Main chat shows the hint
   "Main chat runs on {owner}'s AI. {owner} approves each message." and the
   placeholder "Message main chat — {owner} approves before it's sent".
2. Type the message and choose **Send for approval**. The button keeps that
   label while the assistant is working; members have no separate Steer button.
3. A card appears directly above the composer: **You** with the time, the line
   "Waiting for {owner} to approve", the message and a **Waiting** chip.

Messages for approval are text only: the member composer has no attachment
button. A request that carries attachments is refused with "Messages for
approval are text only. Remove the attachments and send again."

You can have up to 5 messages waiting in one session. A sixth is refused with
"You have 5 messages waiting. Wait for {owner} to review them, or withdraw one."

If the assistant was working when you sent the message, the card adds: "Sent
while the assistant was working. It joins the current turn if it's still running
when {owner} approves." Otherwise the approved message starts a new request.

### Change or withdraw a waiting message

- **Edit** replaces the text with a box. Change it and choose **Save**, or
  **Cancel** to keep the original. An empty text is refused with "Write a
  message, or withdraw it."
- **Withdraw** removes the message from the queue. It stays as the one-line row
  "Withdrawn by you".

Only the sender can edit or withdraw, and only while the message is waiting.
If the owner has already decided, the change fails with "This message was
already sent." (or declined or withdrawn); if it is being sent, with "This
message is being sent."

### What you see after the owner decides

While the chat is open you get a snackbar: "{owner} approved and sent your
message" or "{owner} declined your message". The card becomes a one-line row:

- **Sent by {owner} · time**, with "· Edited by {owner}" when the owner changed
  the text first, and **Show in chat**, which scrolls the conversation to the
  delivered message.
- **Declined by {owner} · time**, with the owner's note quoted underneath when
  they wrote one.

Under each row is the start of the message on one line. On a declined or
withdrawn row, select it to show the whole text, to copy, rework and send it
again.

The delivered message appears in Main chat as an ordinary user message with the
line "{sender} · approved by {owner}" under its text. The assistant's reply is
visible to everyone with access to the project.

Decided rows stay for 24 hours; at most three show at once and the rest are
behind **Show earlier (n)**.

## Review messages as the owner

New messages announce themselves in several places:

- In any open tab where you have that project's Main chat open, a snackbar
  "{sender} sent a message for your approval in {project}" with **Review**,
  which selects the session and scrolls to the waiting messages.
- A **{n} waiting** chip in the Main chat header; choose it to reveal the queue.
- The browser tab title starts with "({n}) " while any messages wait.
- Project lists that support it show a **{n} waiting** badge on the project.

Each waiting card shows "{sender} wants to send · time", the message and these
actions:

- **Approve & send** sends the message unchanged.
- **Edit then send** opens a box with the message. Change it and choose **Send**,
  or **Cancel**. The sender sees "Edited by {owner}" on the Sent row.
- **Decline** opens "Add a note for {sender} (optional)", up to 500 characters.
  Choose **Decline** to confirm, or **Cancel**.

While your approval is being delivered the chip reads **Sending…** and the
buttons are disabled. The owner cannot edit or withdraw a member's message other than by
approving it with edited text.

### How an approved message is delivered

Approving sends the message exactly as if you had sent it yourself, on your AI:

- No turn running: it starts a new request (in Auto, the Router classifies it).
- A turn is running that accepts guidance (including Auto working or an active
  goal): it joins that turn as guidance.
- A turn is running that cannot take guidance, a delivery is uncertain, or
  recovery is in progress: the send fails, the message goes back to **Waiting**
  and the card shows "Couldn't send: {error} Try again." Choose
  **Approve & send** again when the turn finishes.

If a page reload interrupts a send, the card may stay on **Sending…** with
**Send again**. Sending again reuses the same delivery, so the message is never
delivered twice. Its text can't be edited while it is sending; an edited text
is always a new delivery.

If the sender edited the message after you opened it, your action fails with
"{sender} changed this message. Review it again." Read the new text and decide
again.

## Other team members

Members who did not send a message see the same cards, headed "{sender}", with
"Waiting for {owner} to approve" and no actions.

## Phone

On a phone the queue collapses to a bar above the composer, "{n} messages
waiting for approval" (or "Messages for approval" when only decided rows
remain). Tap it to open the **Messages for approval** sheet with the same cards;
buttons stack full width and Edit or Decline open inside the sheet. Close the
sheet with its close button or by tapping outside it.

## What Colleague can do

Colleague can explain all of this. When a team member asks Colleague to send a
message to Main chat, it goes through the same queue and waits for the owner;
Colleague must say so rather than claim it was delivered. In the member's own
lesson there is no queue: the message is sent to the lesson's team AI. Approving, editing,
declining and withdrawing are human-only: Colleague cannot do them, so it should
point the person to the buttons above.

Main chat's **Chat mode** (Senior, Junior, Auto, Custom), its Deslop review and
its automatic save after a completed plan are the owner's too. A team member's
**Chat mode** menu doesn't list the modes, and its **Custom** model choice,
Deslop and automatic save switches are disabled. A
member's or their Colleague's request to change them is refused with "Only the
owner can change its chat mode, review or model", with or without an active goal.
In the member's own lesson they can change it.

## Errors

| Message | Meaning |
|---|---|
| Only the workspace owner can approve messages. | A member tried to approve or decline. |
| Only {sender} can change this message. | Someone else tried to edit or withdraw it. |
| {sender} changed this message. Review it again. | The text changed since you looked. |
| This message was already sent. / declined. / withdrawn. | It has been decided. |
| This message is being sent. | Delivery is in progress; wait for it. |
