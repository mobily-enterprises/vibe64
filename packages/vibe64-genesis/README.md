# @local/vibe64-genesis

The single Vibe64 integration boundary around `genesis-compiler`. It validates
the exact versioned Genesis contracts for environment, workspace preparation,
launch, and deployment so the rest of Vibe64 never parses Stack source or
feature-detects compiler APIs.

Vibe64 explicitly supplies the optional `genesis-stack` catalog through this
boundary. The compiler remains technology-neutral; projects record the catalog
when a piece is selected so they remain portable outside Vibe64.

It initializes Genesis projects, selects Stack pieces, generates Codex task prompts, reads launch declarations, refreshes both Cities, and places the Genesis executable on Codex's PATH. Vibe64 packages use this boundary instead of reproducing Genesis prompts, skills, indexes, or explanatory contracts. Project verification runs through the Genesis CLI inside Vibe64's managed execution environment.

`inspectGenesisSkills()` and `syncGenesisSkills()` expose Genesis's read-only
skill inspection and explicit synchronization. Genesis owns freshness,
project-pinned source selection, and preservation of customizations. Callers
own source-write exclusion and the assistant's context refresh lifecycle.
