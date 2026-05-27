---
title: Setup
description: The vibe64 setup model.
layout: doc
aside: false
---

<div class="why-jskit-page">

<section class="why-jskit-hero">
  <p class="why-jskit-kicker">Setup model</p>
  <div class="why-jskit-ai-ready-title">
    <span>READY</span>
    <span>CHECKED</span>
  </div>
  <p class="why-jskit-lead">
    vibe64 separates machine readiness, adapter readiness, and target
    project readiness so each blocker has a clear owner.
  </p>
  <div class="why-jskit-signal-row">
    <span>studio setup</span>
    <span>adapter setup</span>
    <span>project setup</span>
    <span>accounts</span>
    <span>toolchain</span>
    <span>blocked reasons</span>
  </div>
</section>

<section class="why-jskit-quote-band">
  <p>
    A blocked button is useful
    <span>when it tells you the real blocker.</span>
  </p>
</section>

<section class="why-jskit-grid">
  <article class="why-jskit-card why-jskit-card--xl">
    <p class="why-jskit-card-label">01</p>
    <h2>Studio Setup checks the local studio machine</h2>
    <p>
      Studio-owned checks cover the local runtime and managed toolchain pieces
      the product itself needs before sessions can run.
    </p>
  </article>

  <article class="why-jskit-card">
    <p class="why-jskit-card-label">02</p>
    <h2>Adapter Setup checks the selected target adapter</h2>
    <p>
      Adapter-owned checks decide whether the selected project type can be
      inspected, prompted, commanded, and reviewed.
    </p>
  </article>

  <article class="why-jskit-card why-jskit-card--accent">
    <p class="why-jskit-card-label">03</p>
    <h2>Project Setup checks the target project itself</h2>
    <p>
      Project-specific checks validate scaffold, dependencies, scripts, and
      target readiness before the workflow pretends work can continue.
    </p>
  </article>

  <article class="why-jskit-card">
    <p class="why-jskit-card-label">04</p>
    <h2>Accounts are visible readiness concerns</h2>
    <p>
      GitHub and Codex login orchestration are tracked so blocked workflow
      actions explain what is missing instead of failing late.
    </p>
  </article>

  <article class="why-jskit-card why-jskit-card--wide">
    <p class="why-jskit-card-label">05</p>
    <h2>Setup is not the session</h2>
    <p>
      Setup screens prepare the studio and target. Session steps handle the
      actual delivery checklist.
    </p>
  </article>
</section>

<section class="why-jskit-ai-ready">
  <div class="why-jskit-ai-ready-head">
    <p class="why-jskit-kicker">No magic</p>
    <div class="why-jskit-ai-ready-title">
      <span>LOUD</span>
      <span>FAILS</span>
    </div>
    <p class="why-jskit-ai-ready-lead">
      Readiness checks should expose missing dependencies and invalid config,
      not hide them behind silent machine-specific behavior.
    </p>
  </div>
  <div class="why-jskit-ai-ready-note">
    <p>
      The goal is simple:
      <strong>make the blocker visible before the AI starts inventing around it.</strong>
    </p>
  </div>
</section>

<section class="why-jskit-close">
  <p class="why-jskit-close-top">Machine ready. Adapter ready. Project ready.</p>
  <h2>Then the session can work.</h2>
  <div class="why-jskit-close-actions">
    <a class="why-jskit-button why-jskit-button--primary" href="/">Back to home</a>
    <a class="why-jskit-button why-jskit-button--ghost" href="/adapters">Adapters</a>
  </div>
</section>

</div>
