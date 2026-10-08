# Learning launcher integration prerequisite

The shared Learning UI adapter is ready for the app and project views to attach
to their existing Learning control and lesson picker. This page describes that
integration contract; it does not mean the visible launcher, Main teacher or
practical lesson delivery is finished.

Once attached, the existing L control selects Learning mode. Working mode keeps the person's
working conversations, drafts and background activity. Installed lessons and
saved progress come from the authenticated person's canonical Training reads;
an account change immediately hides the previous person's progress.

A direct Start or Resume request uses the selected installed release or exact
saved attempt. After a confirmed active result, the adapter opens that attempt's
existing Main conversation through the ordinary session Create action. Reopening
does not send a teaching message or create another teacher runtime. The host still
needs to attach selection to the same session panel and implement actual Main
teaching coordination. No desktop or phone acceptance is claimed here.

If Start is unconfirmed, Retry keeps its original request identity, lesson and
revision. Do not replace it with a different lesson request. An ended replay is
history; it does not open a different current attempt. If opening the saved
conversation is unconfirmed, the exact Start retry or Resume uses the original
server opener. A page unload does not preserve this temporary UI retry identity;
read saved progress before making another request after reopening.

Changing account, mode or route while a request is in flight does not undo an
admitted lesson. Its response retains the original attempt identity, but it
cannot open a new conversation or select a late result in the new view. Colleague
can explain the supported Start/Resume flow and offer to use existing actions;
a how-to question alone does not authorize execution. Private provider key entry
and other human-only steps retain their existing boundaries.
