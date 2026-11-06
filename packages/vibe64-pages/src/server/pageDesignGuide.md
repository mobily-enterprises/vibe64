# How to design a Vibe64 page

Read this whole guide before writing a page. Every page links Vibe64's stylesheet
and is built from its classes, so it looks finished in light and dark mode and
on a phone without extra work.

## Rules

1. Decide the reader's first question and answer it at the top: the header,
   then summary tiles with the key counts, then the detail.
2. Link `_vibe64/page.css` in every page and use its classes. It already sets
   the page background, the font and one type scale: bold titles, muted
   secondary text (`v64-muted`), small uppercase section labels. Add your own
   `<style>` only for what the classes do not cover, and colour it only with
   the `--v64-*` tokens (or `color-mix()` of them), never fixed colours, so
   the viewer's light or dark mode carries through.
3. Group detail into sections: a small uppercase label with its summary on the
   right, then cards. One card per item, with a bold title and a muted line.
4. Show status with tinted pills, not words in sentences: `done`, `running`,
   `waiting`, `attention` (needs someone), `error`, `later`, `neutral`. Colour
   always means a status; never use it as decoration.
5. Put comparisons in tables. Give numbers the `v64-num` class so they line up.
6. Draw charts and diagrams as inline SVG with the `v64-chart` class, coloured
   with the tokens (`style="fill: var(--v64-running)"`). Give the SVG `width`
   and `height` equal to its `viewBox` (480 wide or less): it keeps that size
   and shrinks on a phone. Chart only when the data warrants it.
7. No walls of text: short sentences, lists and cards. Lead with the outcome.
8. Keep the page self-contained: its own files only, no outside scripts, fonts
   or images (the sandbox blocks them).
9. The stylesheet gives one readable column with a 16px gutter on phones. Wrap
   wide tables in `<div class="v64-scroll">`; add `class="v64-wide"` to
   `<body>` only for wide dashboards.

## Page skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team Notes status</title>
<link rel="stylesheet" href="_vibe64/page.css">
</head>
<body>
<header class="v64-header">
  <h1>Team Notes status</h1>
  <p class="v64-subtitle">Updated 6 Nov 2026, 10:40</p>
</header>
<!-- summary tiles, then sections -->
</body>
</html>
```

## Summary tiles

```html
<ul class="v64-tiles">
  <li class="v64-tile v64-tile--attention"><b>1</b><span>Needs you</span></li>
  <li class="v64-tile v64-tile--running"><b>2</b><span>Running</span></li>
  <li class="v64-tile v64-tile--done"><b>5</b><span>Done</span></li>
</ul>
```

## Section with a card list

```html
<section class="v64-section">
  <h2 class="v64-section-title">Release <span>5 of 6 done · 83%</span></h2>
  <ul class="v64-cards">
    <li>
      <div class="v64-card-head">
        <span class="v64-card-title">Sign-in page</span>
        <span class="v64-tag">Small</span>
        <span class="v64-pill v64-pill--done">Done</span>
        <span class="v64-tick">✓</span>
      </div>
      <p class="v64-card-meta">Alice · shipped on Tuesday</p>
      <ul><li><b>Tests:</b> 12 passed</li></ul>
    </li>
  </ul>
</section>
```

Standalone cards side by side: `<div class="v64-grid">` holding
`<div class="v64-card">` elements.

## Callout and progress bar

```html
<div class="v64-callout v64-callout--attention"><p><b>Needs you:</b> choose where backups go.</p></div>
<div class="v64-progress v64-progress--running"><i style="width: 60%"></i></div>
```

A callout without a status modifier is informational.

## Table

```html
<div class="v64-scroll">
  <table>
    <tr><th>Option</th><th>Fit</th><th class="v64-num">Setup hours</th></tr>
    <tr><td>SQLite</td><td><span class="v64-pill v64-pill--done">Best now</span></td><td class="v64-num">0</td></tr>
  </table>
</div>
```

## Chart

```html
<svg class="v64-chart" width="480" height="56" viewBox="0 0 480 56" role="img" aria-label="Files by type">
  <text x="0" y="17">.js</text>
  <rect x="48" y="4" width="330" height="18" rx="3" style="fill: var(--v64-running)"></rect>
  <text x="388" y="17">11</text>
  <text x="0" y="47">.md</text>
  <rect x="48" y="34" width="300" height="18" rx="3" style="fill: var(--v64-done)"></rect>
  <text x="358" y="47">10</text>
</svg>
```

## Colour tokens

`--v64-background` (page), `--v64-surface` (cards), `--v64-on-surface` (text),
`--v64-on-surface-muted`, `--v64-outline`, `--v64-track`, `--v64-primary`, and
for each status `--v64-<status>` (text) and `--v64-<status>-tint` (background).

## A page that keeps itself up to date

When the content changes (test results, a status, open issues), make the page a
folder: `index.html` keeps the layout and draws everything from `data.json`,
which holds only the numbers and text. A refresh replaces only `data.json`, so
it can never break the layout. Load the data when the page opens:

```html
<script>
  fetch("data.json").then((response) => response.json()).then((data) => {
    document.querySelector("#passed").textContent = data.passed;
    document.querySelector("#checked").textContent = data.checkedAt;
  });
</script>
```

Show when the data was gathered (`checkedAt`), so a reader knows how fresh it
is. To change only the data yourself, run
`vibe64-helper pages data <page-id> <data.json>`.

Then set the refresh, at most every 15 minutes:

- **Command** (the default, for data a script can gather): write a small script
  (`.mjs`, `.js`, `.cjs`, `.py` or `.sh`) that writes the new `data.json` to the
  file `$VIBE64_PAGE_DATA` names. It runs on Vibe64's server with no AI and so
  no AI cost, from the top folder of a fresh checkout of the project as last
  saved, with no packages installed: use only what the language ships with,
  plus `git`. It has 5 minutes. Try it first in this session, for example
  `VIBE64_PAGE_DATA=/tmp/data.json node refresh.mjs`, then run
  `vibe64-helper pages refresh <page-id> --every 1h --command refresh.mjs`.
- **Prompt** (only when gathering the data needs judgement, such as summarising
  discussions): `vibe64-helper pages refresh <page-id> --daily 07:30
  --time-zone Europe/Rome --prompt "What to find and how to describe it"`. Each
  refresh is a short AI task in this session, run with the AI account of the
  person who asked for the page.

Where Vibe64 doesn't run refresh scripts, `--command` is refused and says so:
set a `--prompt` refresh instead.

A refresh runs as the person who asked for it. A failed refresh keeps the last
good version and shows its log in the Pages list; three failures in a row pause
the schedule. `--off` stops the refreshes.
