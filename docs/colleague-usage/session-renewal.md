# Renew a session

**Renew session** in the session header (or in **Session actions** when the
header is narrow) continues the work in a fresh conversation: review the
handover, confirm, and Vibe64 creates and briefs a fresh session before it
archives the old one. Renewal keeps the old session until the fresh one has
taken over.

## Keep the fresh session's link after renewal

When a completed renewal selects its confirmed fresh session, the address bar
follows that session, including when a background refresh selects it before the
renewal dialog opens it. Reloading or bookmarking the updated link opens the fresh
conversation, including after another renewal. Your chat and project-view choices
in the link stay unchanged. This works on desktop and mobile.

The renewal dialog offers the same main AI as **Start an AI session**: the
owner's Senior, or its recommendation when Senior has no saved choice. Like that
dialog, it shows a saved choice without waiting for each AI tool's model list,
and opening a session reads none either; only opening **Models** does. Keeping
that AI leaves the fresh chat on the main AI; picking a different model makes
it Custom.

If you choose another session or navigate away while the link is opening,
Vibe64 keeps your newer choice. Ordinary session-tab selection keeps its existing
behavior. Colleague can explain renewal and inspect the saved result; opening a
fresh session does not authorize further coding work.

## Cancel a failed renewal

When a renewal fails, the session header's renewal action reads **Renewal needs
attention** and the old session stays in use. Open it to read the error, then
choose one of two ways out:

- **Retry** continues the same saved renewal. Fix the reported condition first. A
  connected project that needs a session is fixed from the old session, so
  [cancel and choose there](connected-contributions.md#renew-a-session-that-uses-connected-sessions).
- **Cancel renewal** stops it. Vibe64 discards the fresh session that renewal
  created and keeps the old session, which you can go on using, renew again
  later or archive.

The button reads **Cancelling…** until Vibe64 confirms, and the dialog closes
when the renewal is cancelled. If discarding the fresh session cannot finish at
once, the dialog shows **Cancelling the renewal…** while Vibe64 retries on its
own; the cancellation is already accepted, and once it finishes the dialog
offers **Prepare handover** for a new renewal. A handover under review is cancelled
the same way. A renewal that is still running, or that has already opened its
fresh session, offers no Cancel renewal. Colleague can explain both choices,
inspect the saved renewal and, when you ask, cancel a failed renewal through the
same action. These steps are the same on desktop and mobile.
