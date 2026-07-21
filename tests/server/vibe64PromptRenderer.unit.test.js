import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PromptRenderer,
  promptSessionBriefing,
  renderPromptTemplate
} from "@local/vibe64-adapters/server";
import {
  questionBatchLimitInstruction
} from "@local/vibe64-adapters/server/promptQuestionPolicy";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const SYSTEM_PROMPT_PACK_ROOT = fileURLToPath(new URL("../../packages/vibe64-adapters/src/server/systemPrompts", import.meta.url));

test("vibe64 prompt renderer renders explicit session context into prompt templates", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await writeFile(
      path.join(promptPackRoot, "make_plan.txt"),
      [
        "Action {{action.id}} for {{session.id}}.",
        "Target: {{session.targetRoot}}",
        "Metadata: {{session.metadata.json}}",
        "Input: {{input.json}}"
      ].join("\n"),
      "utf8"
    );
    const renderer = new PromptRenderer({
      promptPackRoot
    });

    const rendered = await renderer.renderPrompt({
      action: {
        id: "make_plan",
        label: "Make plan",
        type: "prompt"
      },
      input: {
        dryRun: true
      },
      session: {
        currentStep: "plan_and_execute",
        metadata: {
          z_last: "last",
          a_first: "first",
          issue_url: "https://github.test/example/issues/1"
        },
        sessionId: "prompt_session",
        status: "active",
        targetRoot: "/workspace/example"
      }
    });

    assert.equal(rendered.promptId, "make_plan");
    assert.match(rendered.prompt, /Action make_plan for prompt_session/u);
    assert.match(rendered.prompt, /Target: \/workspace\/example/u);
    assert.match(rendered.prompt, /"a_first": "first",\n {2}"issue_url": "https:\/\/github\.test\/example\/issues\/1",\n {2}"z_last": "last"/u);
    assert.match(rendered.prompt, /"dryRun": true/u);
  });
});

test("vibe64 prompt renderer falls back to the fallback prompt", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await writeFile(path.join(promptPackRoot, "fallback.txt"), "Fallback {{action.label}} for {{session.currentStep}}.", "utf8");
    const renderer = new PromptRenderer({
      promptPackRoot
    });

    const rendered = await renderer.renderPrompt({
      action: {
        id: "missing_specific_prompt",
        label: "Missing specific prompt",
        type: "prompt"
      },
      session: {
        currentStep: "example_step"
      }
    });

    assert.equal(rendered.prompt, "Fallback Missing specific prompt for example_step.");
  });
});

test("vibe64 prompt renderer makes the system standard available to adapter prompts", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await withTemporaryRoot(async (systemPromptPackRoot) => {
      await writeFile(
        path.join(promptPackRoot, "make_plan.txt"),
        [
          "{{systemStandard}}",
          "",
          "Adapter guidance for {{adapter.id}}."
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        path.join(systemPromptPackRoot, "make_plan.txt"),
        "System standard for {{action.label}} and {{session.id}}.",
        "utf8"
      );
      const renderer = new PromptRenderer({
        promptPackRoot,
        systemPromptPackRoot
      });

      const rendered = await renderer.renderPrompt({
        action: {
          id: "make_plan",
          label: "Make plan",
          type: "prompt"
        },
        session: {
          adapter: {
            id: "nextjs",
            label: "Next.js"
          },
          sessionId: "prompt_session"
        }
      });

      assert.equal(rendered.systemStandard, "System standard for Make plan and prompt_session.");
      assert.equal(
        rendered.prompt,
        [
          "System standard for Make plan and prompt_session.",
          "",
          "Adapter guidance for nextjs."
        ].join("\n")
      );
    });
  });
});

test("vibe64 prompt overrides can include the rendered system standard", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await withTemporaryRoot(async (systemPromptPackRoot) => {
      await withTemporaryRoot(async (targetRoot) => {
        await writeFile(
          path.join(promptPackRoot, "make_plan.txt"),
          "Adapter prompt includes {{systemStandard}}.",
          "utf8"
        );
        await writeFile(
          path.join(systemPromptPackRoot, "make_plan.txt"),
          "Shared standard for {{session.id}}",
          "utf8"
        );
        const overrideRoot = path.join(targetRoot, ".vibe64", "prompts", "jskit");
        await mkdir(overrideRoot, {
          recursive: true
        });
        await writeFile(
          path.join(overrideRoot, "make_plan.txt"),
          [
            "Custom wrapper.",
            "{{systemStandard}}",
            "{{originalPrompt}}"
          ].join("\n"),
          "utf8"
        );
        const renderer = new PromptRenderer({
          promptPackRoot,
          systemPromptPackRoot
        });

        const rendered = await renderer.renderPrompt({
          action: {
            id: "make_plan",
            label: "Make plan",
            type: "prompt"
          },
          session: {
            adapter: {
              id: "jskit",
              label: "JSKIT"
            },
            sessionId: "prompt_session",
            sourcePath: targetRoot,
            targetRoot
          }
        });

        assert.equal(rendered.originalPrompt, "Adapter prompt includes Shared standard for prompt_session.");
        assert.equal(
          rendered.prompt,
          [
            "Custom wrapper.",
            "Shared standard for prompt_session",
            "Adapter prompt includes Shared standard for prompt_session."
          ].join("\n")
        );
      });
    });
  });
});

test("vibe64 prompt renderer applies target overrides with the rendered original prompt", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      await writeFile(
        path.join(promptPackRoot, "make_plan.txt"),
        "Built-in {{action.label}} for {{session.id}} in {{session.targetRoot}}.",
        "utf8"
      );
      const overrideRoot = path.join(targetRoot, ".vibe64", "prompts", "jskit");
      await mkdir(overrideRoot, {
        recursive: true
      });
      await writeFile(
        path.join(overrideRoot, "make_plan.txt"),
        [
          "Custom wrapper.",
          "{{originalPrompt}}",
          "Also use {{prompt.original}}"
        ].join("\n"),
        "utf8"
      );
      const renderer = new PromptRenderer({
        promptPackRoot
      });

      const rendered = await renderer.renderPrompt({
        action: {
          id: "make_plan",
          label: "Make plan",
          type: "prompt"
        },
        session: {
          adapter: {
            id: "jskit",
            label: "JSKIT"
          },
          sessionId: "prompt_session",
          sourcePath: targetRoot,
          targetRoot
        }
      });

      assert.equal(rendered.originalPrompt, `Built-in Make plan for prompt_session in ${targetRoot}.`);
      assert.equal(
        rendered.prompt,
        [
          "Custom wrapper.",
          `Built-in Make plan for prompt_session in ${targetRoot}.`,
          `Also use Built-in Make plan for prompt_session in ${targetRoot}.`
        ].join("\n")
      );
      assert.equal(rendered.promptOverridePath, path.join(overrideRoot, "make_plan.txt"));
    });
  });
});

test("seed session briefing filters broad discovery contracts while preserving seed contracts", () => {
  const briefing = promptSessionBriefing({
    adapter: {
      id: "jskit",
      label: "JSKIT",
      promptContext: {
        agent_guide_contract: "Read broad JSKIT manuals before choosing modules.",
        generator_discovery_commands: "npx jskit list\nnpx jskit list generators",
        placement_contract: "Read placement docs and list placements.",
        seed_deslop_contract: "Run seed deslop review now.",
        seed_recipe_contract: "Use the mapped seed commands first.",
        tooling_contract: "Use npx jskit from the repository root."
      }
    },
    session: {
      metadata: {
        work_source: "seed"
      },
      sessionId: "seed_briefing",
      targetRoot: "/workspace/example"
    }
  });

  assert.doesNotMatch(briefing, /Read broad JSKIT manuals/u);
  assert.doesNotMatch(briefing, /npx jskit list generators/u);
  assert.doesNotMatch(briefing, /Read placement docs/u);
  assert.doesNotMatch(briefing, /Run seed deslop review now/u);
  assert.match(briefing, /Use the mapped seed commands first/u);
  assert.match(briefing, /Use npx jskit from the repository root/u);
});

test("session briefing keeps the primary preview canonical while permitting explicit reference apps", () => {
  const briefing = promptSessionBriefing({
    session: {
      sessionId: "preview-policy",
      targetRoot: "/workspace/example"
    }
  });

  assert.match(briefing, /Managed preview policy:/u);
  assert.match(briefing, /vibe64-preview ensure --wait --json/u);
  assert.match(briefing, /vibe64-preview status --json/u);
  assert.match(briefing, /vibe64-preview browser eval/u);
  assert.match(briefing, /real Playwright `browser`, `context`, and `page`/u);
  assert.match(briefing, /automatically recovers a killed preview or browser worker/u);
  assert.match(briefing, /Codex's internal managed browser has its own application session/u);
  assert.match(briefing, /separate from the user's visible Preview/u);
  assert.match(briefing, /For authenticated verification, first run `vibe64-preview browser identity you`/u);
  assert.match(briefing, /immediately retry with the authorized explicit application identity/u);
  assert.match(briefing, /report an authentication blocker only if both attempts fail/u);
  assert.match(briefing, /When reporting authentication state, always name the browser explicitly/u);
  assert.match(briefing, /vibe64-playwright test/u);
  assert.match(briefing, /exact managed browser version/u);
  assert.match(briefing, /automatically ensure the current managed preview/u);
  assert.match(briefing, /supply its agent origin as `PLAYWRIGHT_BASE_URL`/u);
  assert.match(briefing, /Do not inspect or hard-code managed ports/u);
  assert.match(briefing, /add Vibe64 URL-discovery helpers/u);
  assert.match(briefing, /Immediately run `vibe64-preview screenshot`/u);
  assert.match(briefing, /read its JSON capture metadata/u);
  assert.match(briefing, /unique immutable `outputPath`, `sha256`/u);
  assert.match(briefing, /DOM text summary, luminance, and dark-pixel percentage/u);
  assert.match(briefing, /interaction request.+takes precedence over the initial-screenshot rule/u);
  assert.match(briefing, /do not capture before acting/u);
  assert.match(briefing, /Use one `vibe64-preview browser eval` call/u);
  assert.match(briefing, /Take exactly one post-action screenshot only when/u);
  assert.match(briefing, /Never claim that the application is black/u);
  assert.match(briefing, /run `sha256sum` on the same `outputPath`/u);
  assert.match(briefing, /reopen that exact file once without taking another screenshot/u);
  assert.match(briefing, /image-handoff failure/u);
  assert.match(briefing, /one command idempotently ensures the preview/u);
  assert.match(briefing, /managed Playwright/u);
  assert.match(briefing, /before reading AGENTS\.md/u);
  assert.match(briefing, /Never use `npx playwright`/u);
  assert.match(briefing, /Never infer page appearance from source code/u);
  assert.match(briefing, /vibe64-preview logs --lines 200/u);
  assert.match(briefing, /without requiring the user to open it first/u);
  assert.match(briefing, /do not treat an unobserved current page as a missing preview/u);
  assert.match(briefing, /canonical server for the configured primary application/u);
  assert.match(briefing, /distinct secondary application that the user explicitly asks you to run/u);
  assert.match(briefing, /legacy app used for comparison/u);
  assert.match(briefing, /navigate that browser to the auxiliary localhost URL/u);
  assert.match(briefing, /never changes the user's visible Preview/u);
  assert.match(briefing, /Do not start a duplicate copy/u);
  assert.match(briefing, /even if a different port appears free/u);
  assert.doesNotMatch(briefing, /Never start another development server/u);
  assert.doesNotMatch(briefing, /only permitted app server/u);
});

test("novice workflow briefing keeps all visible communication simple", () => {
  const briefing = promptSessionBriefing({
    session: {
      sessionId: "guided-session",
      targetRoot: "/workspace/example",
      workflowDefinition: {
        creationAudience: "novice"
      }
    }
  });

  assert.match(briefing, /Simple communication profile:/u);
  assert.match(briefing, /live thought and progress updates/u);
  assert.match(briefing, /Use short, concrete sentences/u);
  assert.match(briefing, /Avoid implementation jargon/u);

  const standardBriefing = promptSessionBriefing({
    session: {
      sessionId: "expert-session",
      targetRoot: "/workspace/example",
      workflowDefinition: {
        creationAudience: "expert"
      }
    }
  });
  assert.doesNotMatch(standardBriefing, /Simple communication profile:/u);
});

test("session briefing prohibits dependency patches without informed human approval", () => {
  const briefing = promptSessionBriefing({
    session: {
      sessionId: "dependency-patch-policy",
      targetRoot: "/workspace/example"
    }
  });

  assert.match(briefing, /Dependency patch policy:/u);
  assert.match(briefing, /Do not patch dependency code unless the human explicitly approves that exact workaround/u);
  assert.match(briefing, /Requests to fix a bug, pass tests, finish work, or commit changes are not approval/u);
  assert.match(briefing, /First diagnose and report the package and version, minimal reproduction, failure, root-cause evidence/u);
  assert.match(briefing, /Before requesting approval, list the exact patch, script, lockfile, install-hook, and dependency changes/u);
  assert.match(briefing, /Without approval after that disclosure, leave the workaround unapplied and unchanged/u);
});

test("vibe64 prompt renderer ignores project-home prompt overrides without a session source", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      await writeFile(
        path.join(promptPackRoot, "make_plan.txt"),
        "Built-in {{action.label}} for {{session.id}}.",
        "utf8"
      );
      const overrideRoot = path.join(targetRoot, ".vibe64", "prompts", "jskit");
      await mkdir(overrideRoot, {
        recursive: true
      });
      await writeFile(
        path.join(overrideRoot, "make_plan.txt"),
        "Project-home override must not apply.",
        "utf8"
      );
      const renderer = new PromptRenderer({
        promptPackRoot
      });

      const rendered = await renderer.renderPrompt({
        action: {
          id: "make_plan",
          label: "Make plan",
          type: "prompt"
        },
        session: {
          adapter: {
            id: "jskit",
            label: "JSKIT"
          },
          sessionId: "prompt_session",
          targetRoot
        }
      });

      assert.equal(rendered.prompt, "Built-in Make plan for prompt_session.");
      assert.equal(rendered.promptOverridePath, "");
    });
  });
});

test("vibe64 prompt renderer does not create target files when no override exists", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      const stateRoot = path.join(targetRoot, "server-state");
      await writeFile(
        path.join(promptPackRoot, "make_plan.txt"),
        "Built-in {{action.label}} for {{session.id}}.",
        "utf8"
      );
      const renderer = new PromptRenderer({
        promptPackRoot
      });

      const rendered = await renderer.renderPrompt({
        action: {
          id: "make_plan",
          label: "Make plan",
          type: "prompt"
        },
        session: {
          adapter: {
            id: "jskit",
            label: "JSKIT"
          },
          sessionId: "prompt_session",
          stateRoot,
          targetRoot
        }
      });

      assert.equal(rendered.prompt, "Built-in Make plan for prompt_session.");
      await assert.rejects(
        access(path.join(targetRoot, ".vibe64", "prompts")),
        /ENOENT/u
      );
      await assert.rejects(
        access(path.join(stateRoot, "prompts")),
        /ENOENT/u
      );
    });
  });
});

test("execute and deslop standard prompts explicitly point Codex at the generated code index", async () => {
  const renderer = new PromptRenderer({
    promptPackRoot: SYSTEM_PROMPT_PACK_ROOT,
    systemPromptPackRoot: false
  });
  const baseSession = {
    currentStep: "plan_and_execute",
    metadata: {
      code_index_path: ".jskit/helper-map.md"
    },
    sessionId: "code_index_prompt",
    targetRoot: "/workspace/example"
  };

  const executePlan = await renderer.renderPrompt({
    action: {
      id: "execute_plan",
      label: "Execute plan",
      promptId: "execute_plan",
      type: "prompt"
    },
    session: baseSession
  });
  const runDeslop = await renderer.renderPrompt({
    action: {
      id: "run_deslop",
      label: "Run deslop",
      promptId: "run_deslop",
      type: "prompt"
    },
    session: {
      ...baseSession,
      currentStep: "review_and_validate"
    }
  });
  const makePlan = await renderer.renderPrompt({
    action: {
      id: "make_plan",
      label: "Make plan",
      promptId: "make_plan",
      type: "prompt"
    },
    session: {
      ...baseSession,
      currentStep: "plan_and_execute"
    }
  });

  assert.match(executePlan.prompt, /Code index policy:/u);
  assert.match(executePlan.prompt, /If Relevant workflow facts include `code_index_path`, read that generated code index before adding helpers/u);
  assert.match(executePlan.prompt, /Fast check policy:/u);
  assert.match(executePlan.prompt, /Do not run the full test suite/u);
  assert.match(executePlan.prompt, /Run only the narrow fast check or checks that directly prove the implementation/u);
  assert.match(runDeslop.prompt, /Code index policy:/u);
  assert.match(runDeslop.prompt, /If Relevant workflow facts include `code_index_path`, read that generated code index before reviewing helper-like code/u);
  assert.match(runDeslop.prompt, /Diff policy:/u);
  assert.match(runDeslop.prompt, /Plain `git diff` does not show untracked scaffold files/u);
  assert.match(runDeslop.prompt, /git diff --no-index -- \/dev\/null <path>/u);
  assert.match(runDeslop.prompt, /Vibe64 control-file policy:/u);
  assert.match(runDeslop.prompt, /`vibe64\.project\.json`/u);
  assert.match(runDeslop.prompt, /`vibe64\.runtime-lock\.json`/u);
  assert.match(runDeslop.prompt, /Do not delete, move, or overwrite source contract files to clean a diff/u);
  assert.match(runDeslop.prompt, /Do not commit or rewrite runtime-local state/u);
  assert.doesNotMatch(makePlan.prompt, /Code index policy:/u);
});

test("seed standard prompts require the app root to be the session clone root", async () => {
  const renderer = new PromptRenderer({
    promptPackRoot: SYSTEM_PROMPT_PACK_ROOT,
    systemPromptPackRoot: false
  });
  const baseSession = {
	    currentStep: "seed_plan_executed",
	    metadata: {
	      work_source: "seed",
	      source_path: "/workspace/runtime/projects/example/sessions/active/seed/source"
	    },
    sessionId: "seed_root_prompt",
    targetRoot: "/workspace/example"
  };

  const prompts = await Promise.all([
    renderer.renderPrompt({
      action: {
        id: "define_seed_application",
        label: "Discuss seed choices",
        promptId: "define_seed_application",
        type: "prompt"
      },
      session: {
        ...baseSession,
        currentStep: "seed_application_defined"
      }
    }),
    renderer.renderPrompt({
      action: {
        id: "make_seed_plan",
        label: "Make seed plan",
        promptId: "make_seed_plan",
        type: "prompt"
      },
      session: {
        ...baseSession,
        currentStep: "seed_plan_made"
      }
    }),
    renderer.renderPrompt({
      action: {
        id: "execute_seed_plan",
        label: "Execute seed plan",
        promptId: "execute_seed_plan",
        type: "prompt"
      },
      session: baseSession
    })
  ]);

  for (const rendered of prompts) {
    assert.match(rendered.prompt, /Seed root contract:/u);
    assert.match(rendered.prompt, /session clone path is the application root/u);
    assert.match(rendered.prompt, /Do not .*nested app directory/u);
    assert.match(rendered.prompt, /Later Vibe64 commands run from the session source root|later Vibe64 commands must end up directly at the session source root/u);
    assert.match(rendered.prompt, /Minimum app behavior contract:|minimal visible app workflow/u);
    assert.match(rendered.prompt, /smallest visible, usable slice|small visible workflow|minimal visible app workflow/u);
    assert.match(rendered.prompt, /browser-local state|local\/browser state/u);
  }
});

test("seed deslop standard prompt carries seed scope without replacing deslop instructions", async () => {
  const renderer = new PromptRenderer({
    promptPackRoot: SYSTEM_PROMPT_PACK_ROOT,
    systemPromptPackRoot: false
  });

  const rendered = await renderer.renderPrompt({
    action: {
      id: "run_deslop",
      label: "Run deslop",
      promptId: "run_deslop",
      type: "prompt"
    },
    session: {
      currentStep: "review_and_validate",
      metadata: {
        workflow_definition: "local_source_seed_application"
      },
      sessionId: "seed_deslop_prompt",
      targetRoot: "/workspace/example"
    }
  });

  assert.match(rendered.prompt, /Seed work profile:/u);
  assert.match(rendered.prompt, /accepted seed recipe/u);
  assert.match(rendered.prompt, /Vibe64 standard review\/deslop instructions/u);
  assert.match(rendered.prompt, /Review the current work for bugs, behavioral regressions, unclear code, weak tests/u);
});

test("draft issue standard prompt reads github issue mode from automatic action context", async () => {
  const renderer = new PromptRenderer({
    promptPackRoot: SYSTEM_PROMPT_PACK_ROOT,
    systemPromptPackRoot: false
  });

  const rendered = await renderer.renderPrompt({
    action: {
      id: "draft_issue",
      label: "Describe work",
      promptId: "draft_issue",
      type: "prompt"
    },
    session: {
      currentStep: "issue_file_created",
      metadata: {
        github_issue_mode: "create",
        work_source: "new_issue"
      },
      sessionId: "draft_issue_prompt",
      targetRoot: "/workspace/example"
    }
  });

  const instructionIndex = rendered.prompt.indexOf("If Relevant workflow facts show `github_issue_mode` as `create`");
  assert.notEqual(instructionIndex, -1);
  assert.match(rendered.prompt, /Use `github_issue_mode` from Relevant workflow facts/u);
  assert.equal(rendered.prompt.includes("{{session.metadata.json}}"), false);
});

test("agent conversation prompt keeps simple conversation out of project preflight work", async () => {
  const renderer = new PromptRenderer({
    promptPackRoot: SYSTEM_PROMPT_PACK_ROOT,
    systemPromptPackRoot: false
  });

  const rendered = await renderer.renderPrompt({
    action: {
      id: "agent_conversation",
      label: "Talk to Codex",
      promptId: "agent_conversation",
      type: "prompt"
    },
    input: {
      conversationRequest: "How are you?"
    },
    session: {
      artifactsRoot: "/workspace/.vibe64-runtime/projects/example/sessions/active/direct_conversation_prompt/artifacts",
      currentStep: "maintenance_conversation",
      currentStepDefinition: {
        autopilot: {},
        label: "Talk to Codex"
      },
      metadata: {},
      sessionId: "direct_conversation_prompt",
      targetRoot: "/workspace",
      worktreePath: "/workspace/.vibe64-runtime/projects/example/sessions/active/direct_conversation_prompt/worktree"
    }
  });

  assert.match(rendered.prompt, /do not read repository files, list directories, or inspect artifacts first/u);
  assert.match(rendered.prompt, /Write one normal user-facing response/u);
  assert.match(rendered.prompt, /Do not append Vibe64 transport markers, JSON metadata, or a duplicate copy/u);
  assert.doesNotMatch(rendered.prompt, /VIBE64_AGENT_RESULT/u);
  assert.doesNotMatch(rendered.prompt, /result envelope/u);
  assert.doesNotMatch(rendered.prompt, /This is an interactive conversation step/u);
  assert.doesNotMatch(rendered.prompt, /input_format\.json/u);
});

test("vibe64 missing-information policy uses the shared question batch limit", () => {
  const rendered = renderPromptTemplate("Policy:\n{{prompt.missingInformationPolicy}}", {
    action: {},
    input: {},
    product: "vibe64",
    session: {}
  });

  assert.match(rendered, /ask concise questions before planning or implementing/u);
  assert.ok(rendered.includes(questionBatchLimitInstruction()));
});

test("vibe64 prompt renderer can mask static context after the session briefing", () => {
  const rendered = renderPromptTemplate([
    "Commands: {{adapter.commands.json}}",
    "Facts: {{adapter.facts.json}}",
    "Blueprint: {{adapter.promptContext.environment_blueprint}}",
    "Services: {{adapter.managedServices.json}}",
    "Policy: {{prompt.managedServicePolicy}}",
    "Config: {{config.json}}",
    "Context: {{context.json}}"
  ].join("\n"), {
    adapter: {
      commands: [
        {
          id: "large_static_command",
          label: "Large static command"
        }
      ],
      facts: {
        summary: "Large static project summary"
      },
      managedServices: [
        {
          label: "Large static database service"
        }
      ],
      promptContext: {
        environment_blueprint: "Large static environment blueprint"
      }
    },
    config: {
      framework: "large-static-config"
    },
    prompt: {
      staticContextMode: "reference"
    },
    product: "vibe64",
    session: {}
  });

  assert.match(rendered, /Vibe64 session briefing/u);
  assert.match(rendered, /adapter\.promptContext\.environment_blueprint/u);
  assert.match(rendered, /Adapter commands are runtime-only Studio metadata/u);
  assert.doesNotMatch(rendered, /Large static command/u);
  assert.doesNotMatch(rendered, /Large static project summary/u);
  assert.doesNotMatch(rendered, /Large static database service/u);
  assert.doesNotMatch(rendered, /Large static environment blueprint/u);
  assert.doesNotMatch(rendered, /large-static-config/u);
});

test("vibe64 session briefing contains the static adapter setup once", () => {
  const briefing = promptSessionBriefing({
    adapter: {
      commands: [
        {
          available: true,
          id: "noisy_top_level_command",
          label: "Noisy top-level command"
        }
      ],
      facts: {
        capabilities: {
          noisy_runtime_capability: true
        },
        commands: [
          {
            available: true,
            id: "noisy_runtime_command",
            label: "Noisy runtime command"
          }
        ],
        summary: "Prompt-aware project"
      },
      id: "fake",
      label: "Fake adapter",
      managedServices: [
        {
          checkCommand: "mariadb --execute=\"SELECT 1\"",
          client: "mariadb",
          command: "mariadb --execute=\"<SQL>\"",
          environment: {
            DB_HOST: "database host",
            DB_NAME: "database name"
          },
          generatorTokenHints: {
            database: "$DB_NAME",
            host: "$DB_HOST"
          },
          id: "managed-db",
          interactiveCommand: "mariadb",
          kind: "database",
          label: "Managed database",
          notes: [
            "Noisy service note"
          ],
          runtime: "mariadb"
        }
      ],
      promptContext: {
        agent_guide_contract: "Read the guide.",
        adapter: "fake",
        blueprint_path: "/workspace/.jskit/APP_BLUEPRINT.md",
        blueprint_relative_path: ".jskit/APP_BLUEPRINT.md",
        database_contract: "Use the configured database runtime.",
        database_runtime: "mariadb",
        generator_discovery_commands: "npx jskit list",
        package_name: "briefing-app",
        target_root: "/workspace",
        tooling_contract: "Use generated JSKIT files.",
        ui_verification_contract: "Record UI receipts with verify-ui."
      }
    },
    config: {
      fields: [
        {
          id: "packageManager",
          label: "Package manager",
          type: "string"
        }
      ],
      fieldValues: {
        packageManager: {
          filePath: "/workspace/vibe64.project.json",
          saved: true,
          value: "npm"
        }
      },
      projectType: "fake",
      ready: true,
      values: {
        packageManager: "npm"
      }
    },
    session: {
      artifactsRoot: "/workspace/.vibe64-runtime/projects/example/sessions/active/briefing_session/artifacts",
      metadataRoot: "/workspace/.vibe64-runtime/projects/example/sessions/active/briefing_session/metadata",
      metadata: {
        code_index_path: ".vibe64/code-index.md"
      },
      sessionId: "briefing_session",
      sessionRoot: "/workspace/.vibe64-runtime/projects/example/sessions/active/briefing_session",
      targetRoot: "/workspace",
      worktree: "/workspace/worktree"
    }
  });

  assert.match(briefing, /Vibe64 session briefing/u);
  assert.match(briefing, /Session logs and diagnostics:/u);
  assert.match(briefing, /- session diagnostics root: \/workspace\/\.vibe64-runtime\/projects\/example\/sessions\/active\/briefing_session/u);
  assert.match(briefing, /- latest preview diagnostic: \/workspace\/\.vibe64-runtime\/projects\/example\/sessions\/active\/briefing_session\/preview-last\.json/u);
  assert.match(briefing, /- preview diagnostic log: \/workspace\/\.vibe64-runtime\/projects\/example\/sessions\/active\/briefing_session\/preview-log\.jsonl/u);
  assert.match(briefing, /read these files before guessing, rebuilding, reinstalling packages, or rerunning commands/u);
  assert.doesNotMatch(briefing, /Adapter project facts/u);
  assert.doesNotMatch(briefing, /Prompt-aware project/u);
  assert.doesNotMatch(briefing, /noisy_runtime_capability/u);
  assert.doesNotMatch(briefing, /noisy_runtime_command/u);
  assert.doesNotMatch(briefing, /noisy_top_level_command/u);
  assert.doesNotMatch(briefing, /Noisy top-level command/u);
  assert.match(briefing, /Summary:\n- blueprint relative path: \.jskit\/APP_BLUEPRINT\.md\n- database runtime: mariadb\n- package name: briefing-app/u);
  assert.doesNotMatch(briefing, /Summary:[\s\S]*blueprint path: \/workspace\/\.jskit\/APP_BLUEPRINT\.md[\s\S]*Agent guide contract/u);
  assert.doesNotMatch(briefing, /Summary:[\s\S]*target root: \/workspace[\s\S]*Agent guide contract/u);
  assert.doesNotMatch(briefing, /Summary:[\s\S]*adapter: fake[\s\S]*Agent guide contract/u);
  assert.match(briefing, /Agent guide contract:\nRead the guide\./u);
  assert.match(briefing, /Tooling contract:\nUse generated JSKIT files\./u);
  assert.match(briefing, /Database contract:\nUse the configured database runtime\./u);
  assert.match(briefing, /UI verification contract:\nRecord UI receipts with verify-ui\./u);
  assert.match(briefing, /Generator discovery commands:\nnpx jskit list/u);
  assert.doesNotMatch(briefing, /"agent_guide_contract"/u);
  assert.match(briefing, /Managed services:\n- Managed database \(managed-db, database, mariadb\)/u);
  assert.match(briefing, /check: mariadb --execute="SELECT 1"/u);
  assert.match(briefing, /run SQL: mariadb --execute="<SQL>"/u);
  assert.doesNotMatch(briefing, /fallback client:/u);
  assert.match(briefing, /env vars: DB_HOST, DB_NAME/u);
  assert.match(briefing, /generator tokens: database=\$DB_NAME, host=\$DB_HOST/u);
  assert.doesNotMatch(briefing, /interactiveCommand/u);
  assert.doesNotMatch(briefing, /Noisy service note/u);
  assert.match(briefing, /Git command policy:/u);
  assert.match(briefing, /Use the managed Vibe64 `git` and `gh` commands/u);
  assert.match(briefing, /Do not run absolute or host Git\/GitHub binaries such as `\/usr\/bin\/git`/u);
  assert.match(briefing, /Do not bypass the managed command path with `command -p`/u);
  assert.match(briefing, /Do not retry with host binaries/u);
  assert.match(briefing, /packageManager/u);
  assert.match(briefing, /"values": \{\n {4}"packageManager": "npm"\n {2}\}/u);
  assert.doesNotMatch(briefing, /fieldValues/u);
  assert.doesNotMatch(briefing, /\/workspace\/\.vibe64\/config\/packageManager/u);
  assert.match(briefing, /Vibe64 control-file policy:/u);
  assert.match(briefing, /`vibe64\.project\.json`/u);
  assert.match(briefing, /`vibe64\.runtime-lock\.json`/u);
  assert.match(briefing, /Committed source contract files/u);
  assert.match(briefing, /Runtime-local Vibe64 state includes project `runtime-config\/\*`/u);
  assert.match(briefing, /Do not delete, move, or overwrite committed source contract files/u);
  assert.match(briefing, /Do not commit or rewrite runtime-local Vibe64 state/u);
  assert.match(briefing, /Generated code index path: \.vibe64\/code-index\.md/u);
  assert.match(briefing, /Vibe64 agent result routing:/u);
  assert.match(briefing, /Ordinary interactive conversation turns use the normal assistant response/u);
  assert.match(briefing, /provide a Vibe64 workflow-result control/u);
  assert.match(briefing, /Never print workflow-result arguments, JSON, or transport metadata/u);
  assert.doesNotMatch(briefing, /VIBE64_AGENT_RESULT_BEGIN/u);
  assert.match(briefing, /does not include `VIBE64_ROUTED_TURN`/u);
  assert.match(briefing, /Direct terminal input does not advance Vibe64 workflow state/u);
});

test("vibe64 prompt templates reject unknown tokens", () => {
  assert.throws(
    () => renderPromptTemplate("{{unknown.token}}", {
      action: {},
      input: {},
      product: "vibe64",
      session: {}
    }),
    /Unknown Vibe64 prompt token/u
  );
});

test("vibe64 prompt templates can render scalar adapter prompt context tokens", () => {
  assert.equal(
    renderPromptTemplate("Blueprint:\n{{adapter.promptContext.blueprint}}", {
      adapter: {
        promptContext: {
          blueprint: "Use Prisma server-side."
        }
      },
      action: {},
      input: {},
      product: "vibe64",
      session: {}
    }),
    "Blueprint:\nUse Prisma server-side."
  );
});

test("vibe64 prompt templates can render managed services without container internals", () => {
  const rendered = renderPromptTemplate("Services:\n{{adapter.managedServices.json}}\nPolicy:\n{{prompt.managedServicePolicy}}\nContext:\n{{context.json}}", {
    adapter: {
      managedServices: [
        {
          client: "psql",
          id: "postgres",
          label: "PostgreSQL",
          generatorTokenHints: {
            host: "$PGHOST",
            password: "$PGPASSWORD"
          }
        }
      ]
    },
    action: {},
    input: {},
    product: "vibe64",
    session: {}
  });

  assert.match(rendered, /"id": "postgres"/u);
  assert.match(rendered, /"label": "PostgreSQL"/u);
  assert.match(rendered, /"managedServices": \[/u);
  assert.match(rendered, /npx jskit/u);
  assert.match(rendered, /bare interactive database client/u);
});
