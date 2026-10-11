# Engineering approach

## Profile

- `focused.v1`

## Project requirements

- Every application change must update affected Colleague usage guides in the
  same change and verify them against the resulting UI and actions. Follow
  AGENTS.md's Colleague Usage Documentation requirements; ship guides with the
  matching application release.

New status and recovery notices use the shared theme's paired surface and
foreground tokens, or a semantic warning/error alert. Do not introduce component
specific grey backgrounds or independent low-contrast text colours. Keep disabled
notice actions readable in light and dark themes; reuse the application-level
notice control rule rather than overriding each button separately.
