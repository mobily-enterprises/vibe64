# Review Back navigation in a JSKIT app

Open the project's working session and use its coding chat to request a
navigation review. For example: “Check every page for a sensible Back button.
Back should normally return to the previous page, preserving its filters and
selected tab. Explain any fixed destination or page that should omit Back.”
The same chat request works on desktop and mobile.

The coding agent checks the button's presence, placement, label and actual
destination using the project's JSKIT guidance. A fixed **Back to appointments**
link can be appropriate, but ordinary **Back** should follow the route the person
took. Direct links and new tabs need a sensible fallback when there is no usable
previous page. Loading, error and narrow-screen layouts still need usable
navigation.

Ask the agent to enter the same page from two different places and check each
return path, including filters, tabs and pagination. A review should identify
which paths it verified and which still need checking. If Back goes somewhere
unexpected, report both the starting page and the route taken to reach it.

When you request **Deslop** for UI changes, its JSKIT audit also checks Back's
position and navigational meaning. Deslop preserves behavior: navigation defects
outside the requested correction scope remain findings for a separate fix.
To authorize repairs, explicitly ask the coding agent to fix those findings.

Colleague can explain these steps and offer to send the request to a coding
conversation through its existing authorized chat operations. A how-to question
or offer does not start the review. Colleague does not inspect application source
or run browser checks itself; the coding agent performs that work and reports
the results.
