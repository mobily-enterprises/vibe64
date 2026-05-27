---
title: Adapters
description: How vibe64 keeps target-specific behavior behind adapter boundaries.
layout: doc
aside: false
---

<div class="why-jskit-page">

<section class="why-jskit-hero">
  <p class="why-jskit-kicker">Adapters</p>
  <div class="why-jskit-ai-ready-title">
    <span>TARGET</span>
    <span>REALITY</span>
  </div>
  <p class="why-jskit-lead">
    vibe64 is the workflow product. Adapters own project-specific reality:
    inspection, setup checks, commands, prompt context, terminals, and files.
  </p>
  <div class="why-jskit-signal-row">
    <span>detect</span>
    <span>inspect</span>
    <span>commands</span>
    <span>prompts</span>
    <span>artifacts</span>
    <span>doctors</span>
  </div>
</section>

<section class="why-jskit-grid">
  <article class="why-jskit-card why-jskit-card--xl">
    <p class="why-jskit-card-label">01</p>
    <h2>JSKIT is the first target adapter</h2>
    <p>
      The JSKIT adapter knows how to inspect a JSKIT app, expose JSKIT-specific
      setup checks, render JSKIT-aware prompts, and provide deterministic commands
      for the Studio workflow.
    </p>
  </article>

  <article class="why-jskit-card">
    <p class="why-jskit-card-label">02</p>
    <h2>The product is not JSKIT-specific</h2>
    <p>
      The core runtime is designed so Python, C++, web app, and other project
      adapters can plug in without taking over session state.
    </p>
  </article>

  <article class="why-jskit-card why-jskit-card--accent">
    <p class="why-jskit-card-label">03</p>
    <h2>Adapters answer concrete questions</h2>
    <p>
      What project is this? What setup is missing? Which commands are valid?
      What facts belong in prompts? Which artifacts are editable?
    </p>
  </article>

  <article class="why-jskit-card">
    <p class="why-jskit-card-label">04</p>
    <h2>Target logic stays out of core</h2>
    <p>
      The runtime does not need to know how a framework installs dependencies,
      starts apps, creates reviews, or describes project facts. It asks the adapter.
    </p>
  </article>

  <article class="why-jskit-card why-jskit-card--wide">
    <p class="why-jskit-card-label">05</p>
    <h2>The prompt gets project facts, not guesses</h2>
    <p>
      Adapters contribute structured context that tells Codex what the target
      project is, which files matter, which commands are valid, and which
      conventions should be followed.
    </p>
  </article>
</section>

<section class="why-jskit-wall">
  <div class="why-jskit-wall-copy">
    <p class="why-jskit-kicker">Boundary</p>
    <h2>
      Core owns
      <span>the workflow.</span>
      Adapters own the terrain.
    </h2>
  </div>
  <div class="why-jskit-wall-list">
    <div>
      <strong>An adapter can provide:</strong>
    </div>
    <ul>
      <li>project detection</li>
      <li>project facts</li>
      <li>setup doctor plugins</li>
      <li>command terminal specs</li>
      <li>Codex prompt context</li>
      <li>editable artifact policy</li>
    </ul>
  </div>
</section>

<section class="why-jskit-close">
  <p class="why-jskit-close-top">Target behavior belongs behind a target boundary.</p>
  <h2>No leaks.</h2>
  <div class="why-jskit-close-actions">
    <a class="why-jskit-button why-jskit-button--primary" href="/">Back to home</a>
    <a class="why-jskit-button why-jskit-button--ghost" href="/workflow">Workflow</a>
  </div>
</section>

</div>
