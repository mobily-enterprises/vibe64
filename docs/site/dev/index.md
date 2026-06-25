---
title: Why Vibe64
description: Vibe64 turns AI coding into isolated worktrees, best-practice prompts, review gates, validation, and safer delivery.
layout: doc
aside: false
---

<main class="vibe-marketing vibe-home">
<section class="vibe-hero">
<div class="vibe-hero__inner">
<div class="vibe-mode-pill" aria-label="Vibe64 modes">
<span>Sessions</span>
<span>Autopilot</span>
<em>New</em>
</div>
<h1>AI coding that follows the workflow</h1>
<p>
Vibe64 turns Codex into a disciplined development process: isolated work,
stack-aware prompts, review gates, validation, PR summaries, and safer delivery.
</p>
<div class="vibe-prompt-box">
<div class="vibe-prompt-box__text">Build this feature in a clean work session</div>
<div class="vibe-prompt-box__footer">
<span>+</span>
<strong>Plan</strong>
<a href="/dev/start-building" aria-label="Start building">↑</a>
</div>
</div>
</div>
</section>

<section class="vibe-showcase-list" aria-label="Why Vibe64">
<article class="vibe-showcase-card">
<div class="vibe-showcase-copy">
<p class="vibe-step"><strong>01</strong> / 04 <span>Work stays atomic</span></p>
<h2>Every session gets its own isolated clone, so AI never has to touch a shared checkout.</h2>
<p>
No constant stashing. No accidental edits on main. No mixing unrelated local
changes into a feature. Each task has a clean boundary from issue to PR.
</p>
<a class="vibe-button vibe-button--primary" href="/dev/start-building">Start building</a>
</div>
<div class="vibe-showcase-visual vibe-showcase-visual--worktree" aria-hidden="true">
<div class="vibe-browser-mock">
<div class="vibe-browser-bar"><span></span><span></span><span></span><em>vibe64/session/worktree</em></div>
<div class="vibe-workflow-board">
<div><b>branch</b><span>vibe64/feature-session</span></div>
<div><b>worktree</b><span>isolated checkout</span></div>
<div><b>source</b><span>GitHub issue</span></div>
<div><b>status</b><span>ready to plan</span></div>
</div>
</div>
</div>
</article>

<article class="vibe-showcase-card vibe-showcase-card--reverse">
<div class="vibe-showcase-copy">
<p class="vibe-step"><strong>02</strong> / 04 <span>Best-practice prompts</span></p>
<h2>Codex gets the project rules before it writes code.</h2>
<p>
Vibe64 detects the stack and sends prompts that match the real framework:
JSKIT generators, Laravel Artisan, Next.js routers, C++ build systems, Node
scripts, managed databases, and project-specific checks.
</p>
<a class="vibe-button vibe-button--primary" href="/dev/supported-tech">Supported tech</a>
</div>
<div class="vibe-showcase-visual vibe-showcase-visual--prompt" aria-hidden="true">
<div class="vibe-terminal-mock">
<p>Prompt context</p>
<code>Use existing helpers before creating new ones.</code>
<code>Run the adapter check command before finalizing.</code>
<code>Do not hand-write framework-owned files.</code>
</div>
</div>
</article>

<article class="vibe-showcase-card">
<div class="vibe-showcase-copy">
<p class="vibe-step"><strong>03</strong> / 04 <span>Review before merge</span></p>
<h2>Deslop, human review, and validation happen before the PR is treated as done.</h2>
<p>
Vibe64 pushes AI output through the parts that usually get skipped: focused
review, duplicate-helper checks, automated validation, UI checks when relevant,
and a PR summary reviewers can actually use.
</p>
<a class="vibe-button vibe-button--primary" href="/dev/start-building">Start building</a>
</div>
<div class="vibe-showcase-visual vibe-showcase-visual--review" aria-hidden="true">
<div class="vibe-pr-mock">
<div class="vibe-pr-mock__top">Pull request report</div>
<ul>
<li><span></span> Deslop pass complete</li>
<li><span></span> Automated checks passed</li>
<li><span></span> Review summary attached</li>
<li><span></span> Risks listed for reviewer</li>
</ul>
</div>
</div>
</article>

<article class="vibe-showcase-card vibe-showcase-card--reverse">
<div class="vibe-showcase-copy">
<p class="vibe-step"><strong>04</strong> / 04 <span>Ready to run anywhere</span></p>
<h2>Containers and project tools make development repeatable across machines.</h2>
<p>
Managed services keep databases and runtime tooling portable. Project tools
turn staging deploys, production deploys, main syncs, and MySQL access into
visible repeatable actions instead of tribal knowledge.
</p>
<a class="vibe-button vibe-button--primary" href="/dev/start-building">Start building</a>
</div>
<div class="vibe-showcase-visual vibe-showcase-visual--runtime" aria-hidden="true">
<div class="vibe-runtime-mock">
<div>mysql <span>running</span></div>
<div>toolchain <span>ready</span></div>
<div>staging deploy <span>confirm</span></div>
<div>sync main <span>available</span></div>
</div>
</div>
</article>
</section>

<section class="vibe-faq-section" aria-labelledby="dev-faq-heading">
<div class="vibe-faq-inner">
<div class="vibe-faq-intro">
<p>FAQ</p>
<h2 id="dev-faq-heading">Frequently asked questions</h2>
</div>
<div class="vibe-faq-list">
<details class="vibe-faq-item" open>
<summary>How does Vibe64 keep AI work isolated?</summary>
<p>Each work session gets its own Git branch inside an isolated clone. The agent works in that clone, so unrelated local edits and shared project state stay out of the blast radius.</p>
</details>

<details class="vibe-faq-item">
<summary>Does Vibe64 replace GitHub, Docker, Codex, or my project tooling?</summary>
<p>No. Vibe64 coordinates the tools developers already use. It leans on Git and GitHub for change control, Docker for portable services, Codex for agent work, and the project adapter for stack-specific commands.</p>
</details>

<details class="vibe-faq-item">
<summary>What is an adapter?</summary>
<p>An adapter is the project-specific layer that tells Vibe64 how to inspect, prompt, run, launch, validate, and review a stack. That is where JSKIT, Laravel, Next.js, Node, C++, Vinext, and future stacks get their actual workflow knowledge.</p>
</details>

<details class="vibe-faq-item">
<summary>What happens when Codex produces sloppy code?</summary>
<p>That is the point of the workflow. Vibe64 keeps the change isolated, runs the relevant checks, supports review/deslop passes, and gives reviewers a PR summary with the useful context instead of pretending the first diff is done.</p>
</details>

<details class="vibe-faq-item">
<summary>Can I add project-specific tools?</summary>
<p>Yes. Project tools are intended to expose repeatable project actions such as deploys, syncs, database access, and adapter-provided workflows. They should reuse the existing terminal and runtime infrastructure, not invent a parallel command runner.</p>
</details>

<details class="vibe-faq-item">
<summary>What if my stack is not supported?</summary>
<p>Add an adapter or improve an existing one. Vibe64 works best when the project contract is explicit: detection, prompt context, commands, validation, launch targets, and review expectations should live in code instead of tribal notes.</p>
</details>
</div>
</div>
</section>
</main>
