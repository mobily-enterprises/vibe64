# Review Back navigation in a JSKIT app

Open the project's working session and use its coding chat to request a
navigation review. For example: “Check every page's Up arrow. Up should
return to the previous page, preserving its filters and selected tab, and
open the page's parent after a direct link. Explain any page whose Up goes
somewhere else.” The same chat request works on desktop and mobile.

In a JSKIT app the browser provides Back, and the app's only way back is the
Up arrow JSKIT draws in the top bar of every inner page; the coding agent
checks it against the project's JSKIT guidance. Up follows the route the
person took. Direct links and new tabs open the page's declared parent when
there is no usable previous page. The app draws no Back button, back arrow or
breadcrumb of its own, and `jskit check` fails on one. A button that opens a
named place, such as **Appointments** or **All invoices**, is fine: it is
labelled with that place and its own icon, never **Back** or a back arrow.
Loading, error and narrow-screen layouts still need usable navigation.

Ask the agent to enter the same page from two different places and check each
return path, including filters, tabs and pagination. A review should identify
which paths it verified and which still need checking. If Up goes somewhere
unexpected, report both the starting page and the route taken to reach it.

When you request **Deslop** for UI changes, its JSKIT audit also checks
navigation against these rules. Deslop preserves behavior: navigation defects
outside the requested correction scope remain findings for a separate fix.
To authorize repairs, explicitly ask the coding agent to fix those findings.
A [UI pass](ui-pass.md) on those screens follows the project's UI guidance the
same way and likewise reports, rather than changes, a navigation defect that
would alter behavior.

Colleague can explain these steps and offer to send the request to a coding
conversation through its existing authorized chat operations. A how-to question
or offer does not start the review. Colleague does not inspect application source
or run browser checks itself; the coding agent performs that work and reports
the results.
