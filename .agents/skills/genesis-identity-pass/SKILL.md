---
name: genesis-identity-pass
description: Give software a visual identity of its own (one seed colour, artwork drawn in code for each kind of content, a logo, empty states, a loading screen and a sign-in page) through an explicitly requested identity pass over the whole app, a named section, or the agent's own changes. Use when asked for a visual identity, a look, artwork or a logo, or to make an app look designed rather than like a default template.
---

# Genesis identity pass

Give the software a look of its own, drawn in code, so it reads as designed
rather than as a default template. An identity pass is explicit: never run it
merely because implementation finished.

Resolve the invocation before running the first Genesis operation. Do not use a
Genesis operation or `genesis --version` as an availability probe.

1. Read the repository-root `package.json`. Treat Genesis as project-pinned only
   when that manifest's `name` is `genesis-compiler`, or its `dependencies`,
   `devDependencies`, or `optionalDependencies` contain the exact
   `genesis-compiler` key.
2. For a project-pinned repository, invoke every Genesis CLI operation with
   `npm exec --no -- genesis <arguments>`. This runs without fetching another
   package. If the declared package is not installed, report that the project's
   dependencies are not prepared; do not fall back to another Genesis version.
3. Otherwise, do not try `npm exec`. Run `command -v genesis` (or the current
   shell's equivalent `PATH` lookup). When it resolves an executable, invoke
   `genesis <arguments>` directly.
4. When neither source is available, stop and report that Genesis is
   unavailable. Never install or update Genesis merely to satisfy a workflow
   instruction.

Successful invocation resolution is routine. Do not narrate whether Genesis is
project-pinned or on `PATH`, and never describe direct `PATH` use as a fallback.
Mention how the invocation was selected only when resolution fails or the user
explicitly asks.

Follow the configured Collaboration approach for user-facing updates, including
its technical depth and response length. Report concrete progress,
findings, or blockers; do not announce that you are following guidance.

## Load the effective project instructions once

An identity pass request may arrive as a complete Genesis-generated prompt or
as a direct request such as `Give the app its visual identity`.

If the current task already contains `GENESIS CONTEXT` whose task is
`identity-pass`, continue with it directly. Do not generate another prompt.

Otherwise, before resolving scope, run the Genesis `prompt --task identity-pass`
operation once using the invocation rule above. For a bare request, pass no
request argument. When the user names a section, commits or your own changes,
pass that exact request as one safely quoted argument. Treat the printed prompt
as the instructions for this same turn; do not dispatch it to another agent and
do not generate it again. This step composes the selected Stack's identity pass
guidance and any project customization with the portable contract below.

When the user asks for a deep run of this pass, pass its Deep request,
`Give the whole app its visual identity deeply.`, exactly;
Genesis then adds the run's `DEEP RUN` section.

## Resolve the scope

Inspect `git status --short` and the staged and unstaged diffs before editing.
A dirty worktree is allowed. Preserve the existing index and unrelated work; do
not stage, stash, commit, or discard changes as a prerequisite.

When the prompt has a `PASS RUN` section, the request is one of the pass's own
runs (the whole app, the changes since its last completed run judged against
the whole app, or a deep run) or a run over the changes since a base commit the
request names, and its scope is the one that section states, whatever the
defaults below say. A deep run's prompt also has a `DEEP RUN`
section; follow it with "Deep run" below.

- **The whole app (default).** Every screen or view a person sees, the shell,
  sign-in, the loading screen, the logo and the icons. An identity is
  app-wide, so this is the scope when none is stated.
- **A section.** A named area (a module, a route subtree, a set of screens):
  it receives the app's existing identity, such as art for a new kind of
  content and its empty states.
- **The changes.** Your own changes for the current task, or explicit commits,
  established and resolved as for Deslop: the screens they add or change
  receive the existing identity.

A narrower scope in an app with no identity yet still needs the foundation
(the seed, the colour module and the logo, steps 1 and 2 below): build it, and
report that the rest of the app does not have the identity yet.

## Study the software first

Before drawing anything, run the software and look at its screens, and read the
Blueprint. Write a short look spec, a few lines kept for the report:

- what the software is for, who uses it, and the tone that suits it;
- its **content kinds**: the categories people browse, pick or make (recipes
  by course, workouts by type, books by genre, levels by world). Take them
  from the data the software already has; do not invent a taxonomy the
  product lacks. Art that follows the categories helps people recognise an
  item at a glance;
- the **style option** below that fits, with the reason, and the seed colour.

## Choose a style option

The look is a choice, not a fixed recipe. Pick the option that fits, or the one
the person or the project already uses:

- **Calm interface, energetic artwork.** The default for content apps, where
  people browse, pick or make items. Interface surfaces stay quiet and the
  generated artwork carries the colour and the energy, so the content stays at
  the centre and the interface stays readable in both schemes.
- **Quiet tool.** For work tools, dashboards, administration and developer
  tools, and command-line programs. The identity lives in the seed colour, the
  logo, the type and the empty states, with little or no artwork in lists,
  where density and quick scanning matter more.
- **The project's own brand.** When the project already has brand colours, a
  logo or a style guide, follow them: the brand colour becomes the seed and its
  other colours become named roles. Never redraw a brand's own logo.

Games and other expressive software usually have an art direction already. The
pass then brings the same discipline to it (one source for its colours, seeded
variation, contrast, reduced motion) instead of replacing it.

## Build the identity

Draw everything in code when possible: no stock photos, no downloaded images,
and no new dependency for drawing. Drawn art scales, follows the palette, costs
little, works offline and carries no licence risk. Artwork the person supplies,
and a brand's own files, are used as given. Keep the code small and direct, as
the engineering approach asks: one art component, one colour module, motifs as
data.

1. **One seed colour.** Generate the interface's colour schemes (light and
   dark, where the platform has both) from one seed through the technology's
   own theme mechanism, never by picking each colour by hand: one decision
   keeps every role consistent, and both schemes follow when it changes. A
   deep, slightly cool seed usually keeps its character in both schemes.
   Colour roles the software needs of its own, such as one per content kind,
   are named theme colours harmonised toward the seed, each with the roles for
   writing on it and for a container, working in both schemes.
2. **Every non-interface colour in one place.** Artwork gradients, the logo,
   the sign-in panel, share images and avatar colours are named constants in
   one module, each with a short comment saying where it is used. Interface
   code uses theme roles only, never a literal colour. A colour scattered
   through screens cannot follow the brand and drifts; this is "Data: one
   source for each fact" in
   `.agents/skills/genesis-project/references/sanity-checks.md`.
3. **Artwork for each content kind.** One art component (a cover) draws an
   item's art from its kind and a seed, the item's stable id or slug:
   - per kind, a palette in the colour module: two gradient colours, an accent
     and a light colour. Each kind has its own distinct gradient, and a brand
     kind serves items without one;
   - per kind, a **motif**: a few simple, bold geometric shapes that say what
     the kind is (a bowl and rising steam for soups, a climbing line for
     running, stacked spines for books, a leaf for plants). Describe each motif
     as data (a shape name and its attributes) drawn by one renderer, so a new
     kind is new data rather than new code;
   - a **seeded random generator**, so the same item always draws the same art
     and each item differs a little while staying recognisably its kind. For
     example, mulberry32 over an FNV-1a hash of `kind:seed`:

     ```js
     function randomFor(kind, seed) {
       let h = 2166136261;
       for (const c of `${kind}:${seed}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
       let s = h >>> 0;
       return () => {
         s = (s + 0x6d2b79f5) >>> 0;
         let n = Math.imul(s ^ (s >>> 15), 1 | s);
         n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
         return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
       };
     }
     ```

     Each seed moves the motif's centre a little (right of centre leaves room
     for text), tilts the gradient within about 25 degrees either way, and
     scatters a few soft dots behind the motif (small, in the light colour, at
     low opacity). Never seed from the clock or an unseeded random: the art
     would change on every load;
   - drawing: thick strokes with round caps, two or three opacity levels, and
     the accent used once per motif as its focal point. A wide 2:1 drawing
     cropped to fill its box serves a card, a strip and a thumbnail alike.
     Gradients and other definitions get ids unique to their kind and seed, so
     two covers on one page never share one. The art is decorative: hide it
     from assistive technology and let the item's title carry the meaning.
4. **Where the identity appears**, where the software has these:
   - **content cards** in lists and libraries: the art across the top, then the
     title, the byline, a short description, chips (kind, level) and one meta
     line (date, people). A "Featured" group can come before the rest;
   - **a hero card and a profile header**: a strip of art with the avatar
     overlapping its lower edge;
   - **empty states**: a small cover with the state's icon on a disc in its
     middle, a one-line title, a short hint and one action that gets the
     person going. An empty screen is often a new person's first one;
   - **the logo**: a rounded tile with the brand gradient and one bold symbolic
     mark in two accent colours with a light core. The same drawing is the
     favicon and the app icons. Draw it inline where possible rather than as a
     cached image, so it follows the colour module;
   - **the opening or loading screen**, shown before the software's code runs:
     the logo, the name and a one-line tagline, with a way to reload if startup
     fails. Its motion is gentle and stops when reduced motion is asked for;
   - **sign-in**: on wide windows, a brand panel (a glow from the brand colour
     into a dark ink, the logo, the name, the tagline and three short lines on
     what the software does, with a large faint accent ring and a few soft light
     bubbles); on phones, the logo and the name over a strip of art;
   - a **command-line program** shows its name and tagline in help and version
     output and maps its colours to the terminal's, with no colour when
     `NO_COLOR` is set or the output is not a terminal; a **game** carries the
     identity on its title and loading screens and its icons.
5. **Polish that keeps the identity calm.** Follow the selected Stack's UI pass
   rules for layout; in addition:
   - while loading, show skeletons with the shape of the real content rather
     than a spinner, so nothing jumps when the data arrives;
   - numbers that change use tabular figures (`font-variant-numeric:
     tabular-nums` on the web), so they do not shift as they change;
   - a new item entering a list may pop in briefly (from about 0.6 scale,
     fading in over about 600 ms), with no motion when reduced motion is asked
     for;
   - phone navigation follows the platform's own pattern for its size, and a
     navigation drawer with nothing in it is removed.
6. **Contrast.** Writing on any content or identity colour reaches at least
   4.5:1 (WCAG AA for body text) in every scheme; aim for about 5.4:1 with white
   writing on identity colours, since art and gradients vary beneath it.
   Measure the ratios rather than judging by eye.

## Boundaries

- The pass changes how the software looks and adds only the few words an
  identity needs (a tagline, the sign-in lines, empty-state hints). It does not
  change what the software does: no feature, field, action, permission,
  validation or data change. New words go through the project's translation
  mechanism where it has one. A defect, missing behavior or test gap you notice
  is a follow-up finding, left unchanged.
- The selected Stack's identity pass guidance says where each piece lives;
  the identity never breaks a design rule the Stack marks as must-fix.
- **Fix at the owner.** When the framework itself blocks a result, report the
  exact framework change instead of overriding it in the app's styles.
- You may add the art components, the colour module, the logo and icon files,
  the loading screen and their styles, place the art in screens, and update
  tests whose markup changed; every behavior assertion stays. Do not edit
  `.genesis/`, Git metadata, dependency directories, generated build output,
  retained migration history, or external resources.

## Prove it

- Take screenshots of the main list, a detail page, an empty state, sign-in
  (wide and phone) and the profile, at phone and desktop widths (390 and 1280
  pixels on the web), in light and dark, through the host's managed browser or
  a temporary browser test. Look at every one. Keep them out of the
  repository's tracked files, delete temporary test files, and close every
  browser you start.
- Confirm that every content kind has its own art, that the same item draws the
  same art on every load (render one seed twice, or reload and compare), and
  that two items of one kind differ.
- Measure the contrast of writing on each identity colour in both schemes.
- Confirm that nothing shifts while loading: compare the skeleton and the
  loaded frame, or read the platform's layout-shift measure.
- Run the checks the Stack guidance names and the focused tests of the
  affected screens.
- Update the Blueprint with a short paragraph describing the look in plain
  words: the style option, the seed's character, and the art for each kind of
  content. It is product intent, so it names no files.

Leave the pass as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite selected commits. Summarize the resolved scope,
the look spec (style option, seed, content kinds and their motifs), what
changed, files changed, the checks, contrast figures and screenshots actually
taken (with their paths), and follow-up findings left unchanged.

When the prompt ends with a `PASS RECORD` step, take it once the pass has
finished: the Genesis `passes done identity-pass` operation records it in `genesis/passes.json`,
an uncommitted change that lands in the pass's own commit. Genesis adds that
step only to the pass's own runs, whose requests it writes itself, so an
identity pass of a section, commits or your own changes is never recorded as
the pass; neither is a pass that stopped early, was abandoned or still has
failing checks.

## Deep run

When the prompt has a `DEEP RUN` section, follow it: it says how the checklist,
evidence, chunks, commits and report work for every pass. This pass adds to the
checklist:

- every screen, every kind of content, each empty state, the loading screen,
  sign-in, the logo and the icons;
- the cross-subsystem item: colours, artwork or type defined outside the one
  module and theme, and any screen the identity has not reached.
