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
        currentStep: "plan_made",
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

test("vibe64 prompt renderer falls back to the generic prompt", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await writeFile(path.join(promptPackRoot, "generic.txt"), "Generic {{action.label}} for {{session.currentStep}}.", "utf8");
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

    assert.equal(rendered.prompt, "Generic Missing specific prompt for example_step.");
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
      await assert.rejects(
        access(path.join(targetRoot, ".vibe64", "prompts", "README.md")),
        /ENOENT/u
      );
    });
  });
});

test("vibe64 prompt renderer does not create target files when no override exists", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
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
          targetRoot
        }
      });

      assert.equal(rendered.prompt, "Built-in Make plan for prompt_session.");
      await assert.rejects(
        access(path.join(targetRoot, ".vibe64", "prompts")),
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
    currentStep: "plan_executed",
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
      currentStep: "review_run"
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
      currentStep: "plan_made"
    }
  });

  assert.match(executePlan.prompt, /Code index policy:/u);
  assert.match(executePlan.prompt, /If session metadata includes `code_index_path`, read that generated code index before adding helpers/u);
  assert.match(executePlan.prompt, /Fast check policy:/u);
  assert.match(executePlan.prompt, /Do not run the full test suite/u);
  assert.match(executePlan.prompt, /Run only the narrow fast check or checks that directly prove the implementation/u);
  assert.match(executePlan.prompt, /\.jskit\/helper-map\.md/u);
  assert.match(runDeslop.prompt, /Code index policy:/u);
  assert.match(runDeslop.prompt, /If session metadata includes `code_index_path`, read that generated code index before reviewing helper-like code/u);
  assert.match(runDeslop.prompt, /\.jskit\/helper-map\.md/u);
  assert.doesNotMatch(makePlan.prompt, /Code index policy:/u);
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
      artifactsRoot: "/workspace/.vibe64/session/artifacts",
      currentStep: "maintenance_conversation",
      currentStepDefinition: {
        autopilot: {},
        label: "Talk to Codex"
      },
      metadata: {},
      sessionId: "direct_conversation_prompt",
      targetRoot: "/workspace",
      worktreePath: "/workspace/.vibe64/session/worktree"
    }
  });

  assert.match(rendered.prompt, /do not read repository files, list directories, or inspect existing artifact files first/u);
  assert.match(rendered.prompt, /This is an interactive conversation step/u);
  assert.match(rendered.prompt, /If `session.currentStep` is `agent_conversation`, this is the General coding change-making step/u);
  assert.match(rendered.prompt, /Use the current-step input helper contract appended to this prompt/u);
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
    "Facts: {{adapter.facts.json}}",
    "Blueprint: {{adapter.promptContext.environment_blueprint}}",
    "Services: {{adapter.managedServices.json}}",
    "Policy: {{prompt.managedServicePolicy}}",
    "Config: {{config.json}}",
    "Context: {{context.json}}"
  ].join("\n"), {
    adapter: {
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
  assert.doesNotMatch(rendered, /Large static project summary/u);
  assert.doesNotMatch(rendered, /Large static database service/u);
  assert.doesNotMatch(rendered, /Large static environment blueprint/u);
  assert.doesNotMatch(rendered, /large-static-config/u);
});

test("vibe64 session briefing contains the static adapter setup once", () => {
  const briefing = promptSessionBriefing({
    adapter: {
      facts: {
        summary: "Prompt-aware project"
      },
      id: "fake",
      label: "Fake adapter",
      managedServices: [
        {
          label: "Managed database"
        }
      ],
      promptContext: {
        environment_blueprint: "Static environment blueprint"
      }
    },
    config: {
      packageManager: "npm"
    },
    session: {
      artifactsRoot: "/workspace/.vibe64/session/artifacts",
      metadata: {
        code_index_path: ".vibe64/code-index.md"
      },
      sessionId: "briefing_session",
      targetRoot: "/workspace",
      worktree: "/workspace/worktree"
    }
  });

  assert.match(briefing, /Vibe64 session briefing/u);
  assert.match(briefing, /Prompt-aware project/u);
  assert.match(briefing, /Static environment blueprint/u);
  assert.match(briefing, /Managed database/u);
  assert.match(briefing, /packageManager/u);
  assert.match(briefing, /Generated code index path: \.vibe64\/code-index\.md/u);
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
      ],
      runtimeContainers: [
        {
          containerName: "vibe64-postgres-secret",
          id: "postgres",
          label: "PostgreSQL",
          terminalEnv: {
            DATABASE_URL: "postgresql://example"
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
  assert.doesNotMatch(rendered, /runtimeContainers/u);
  assert.doesNotMatch(rendered, /vibe64-postgres-secret/u);
  assert.doesNotMatch(rendered, /postgresql:\/\/example/u);
});
