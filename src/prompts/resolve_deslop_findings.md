Resolve the listed deslop findings in the current worktree.

Fix only the listed findings. Keep scope tight. Do not create commits, branches, issues, pull requests, merges, or worktree cleanup.

Use existing JSKIT helpers, generators, package seams, and app-local helpers where they fit. Do not introduce helper churn or unrelated refactors while resolving these findings.

[resolve_deslop_findings]
{{findings}}
[/resolve_deslop_findings]

When finished:

- Summarize the exact findings fixed.
- List changed files.
- List checks run, or say why checks were not run.
- Wait for the next review prompt.
