# Prepare a session after updating its source

**Workspace preparation required** means the session needs its declared setup
steps run against the updated source. It is a neutral notice, not a failed run.
For a Node project this can include installing dependencies, but the actual
steps come from the project's setup contract.

Select **Prepare workspace**. The notice shows progress while those steps run.
Use **Expand** to inspect output, or **Dismiss** to hide an inactive notice.
Preparation does not publish the project.

An actual failed command or failure to start preparation still displays an error
and its diagnostic. Use the available retry or **Fix it with AI** action to deal
with that failure; do not assume a required preparation step has already failed.

Colleague can explain the notice and, when explicitly asked, use the session's
authorized workspace-preparation operation. It should inspect the current
result before saying preparation succeeded.
