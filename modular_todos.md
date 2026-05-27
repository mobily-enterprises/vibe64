# Modular Workflow Todos

## 1. State Of The Modules Right Now

- `workflowRegistry.js` now provides a real registry for workflow modules. It can register step definitions, step machines, and workflow definitions, and it detects duplicate ownership. However, it still owns the generic `VIBE64_CORE_WORKFLOW_MODULE_ID = "core"`, which means a concrete module id is still sitting in generic registry code.
- `workflow.js` is still doing two jobs. It is the public workflow lookup/API layer, but it also owns the large built-in core step catalog and the built-in workflow profiles for `seed_application`, `big_feature`, and `general_coding`.
- `workflowStepMachines.js` is also still doing two jobs. It exposes the runtime step-machine API, but it also owns the large built-in set of core machines for session setup, worktree setup, issue creation, planning, execution, validation, commit, PR, merge, sync, and finish.
- `workflowModules/coreMaintenance.js` is the first real module-shaped vertical slice. It owns its module id, its maintenance workflow profile ids, its maintenance-specific step ids, its step definitions, its workflow definitions, and its machines.
- `coreMaintenance.js` composes workflow steps it does not own, such as `session_created`, `worktree_created`, `project_validated`, `changes_committed`, `create_pull_request`, `pr_merged`, `main_checkout_synced`, and `session_finished`. That is the right direction: modules own their own steps, while workflows can be lists of steps from multiple modules.
- Shared primitives have already started moving out of the old central files:
  - `workflowDefinitionBuilders.js` owns generic workflow definition builders such as `agentConversationStep`.
  - `workflowStepMachineHelpers.js` owns reusable machine helpers and machine factories.
  - `workflowArtifacts.js` owns shared artifact-name constants.
  - `workflowProfileIds.js` still owns the remaining built-in coding workflow ids.
- `index.js` exports the generic registry and shared builders, but it does not export the maintenance module id. Maintenance test-only ownership data is exposed through `_testing` from `coreMaintenance.js`.
- The current unresolved architecture problem is that the old `"core"` module is too broad. It mixes lifecycle/delivery steps with coding-specific steps and workflow profiles. That makes ownership less clear than the maintenance module.

## 2. Where We Should Go With It

- Split the current `"core"` bucket into clear modules:
  - `workflowModules/coreLifecycle.js`
  - `workflowModules/coreCoding.js`
  - keep `workflowModules/coreMaintenance.js`
- `coreLifecycle.js` should own reusable lifecycle and delivery steps:
  - `session_created`
  - `work_source_selected`
  - `worktree_created`
  - `dependencies_installed`
  - `project_validated`
  - `changes_committed`
  - `create_pull_request`
  - `pr_merged`
  - `main_checkout_synced`
  - `session_finished`
- `coreCoding.js` should own coding-specific steps and the current built-in coding workflows:
  - `seed_application_defined`
  - `issue_file_created`
  - `issue_submitted`
  - `seed_plan_made`
  - `seed_plan_executed`
  - `plan_made`
  - `plan_executed`
  - `implementation_reviewed`
  - `agent_conversation`
  - `deep_ui_check_run`
  - `review_run`
  - `changes_accepted`
  - `report_created`
  - `project_knowledge_updated`
  - workflows: `seed_application`, `big_feature`, `general_coding`
- `coreMaintenance.js` should stay self-contained for maintenance-specific ownership. It should import only shared builders/helpers and any lifecycle step ids it intentionally composes into its workflows.
- Generic code should stay generic:
  - `workflowRegistry.js` should not own any concrete core module id.
  - `workflow.js` should become a bootstrap/query layer for workflow definitions.
  - `workflowStepMachines.js` should become a bootstrap/query layer for machines plus the runtime API.
  - `workflowDefinitionBuilders.js`, `workflowStepMachineHelpers.js`, and `workflowArtifacts.js` should remain shared.
- Workflow modules should support both parts of the model:
  - defining steps
  - defining workflows as ordered lists of steps
- A workflow should be allowed to reference steps owned by another module, but that should be explicit. The registry should continue rejecting workflows that reference unregistered step definitions.
- Module exports should stay strict:
  - production exports should be module factory functions and deliberate cross-module contracts, such as lifecycle step ids needed by other modules
  - test-only ownership metadata should live under `_testing`
  - concrete module ids should be owned by the modules themselves, not by the registry or public barrel

## 3. Detailed Plan To Get There

1. Add ownership tests before moving more code.

   Update the existing workflow registry tests so they assert:
   - every registered step has both a definition and a machine
   - lifecycle steps are owned by the lifecycle module
   - coding-specific steps are owned by the coding module
   - maintenance-specific steps are owned by the maintenance module
   - coding workflows are owned by the coding module
   - maintenance workflows are owned by the maintenance module
   - maintenance workflows may reference lifecycle steps without owning them

2. Introduce `workflowModules/coreLifecycle.js`.

   Move these definitions out of `workflow.js`:
   - `session_created`
   - `work_source_selected`
   - `worktree_created`
   - `dependencies_installed`
   - `project_validated`
   - `changes_committed`
   - `create_pull_request`
   - `pr_merged`
   - `main_checkout_synced`
   - `session_finished`

   Move the matching machines out of `workflowStepMachines.js`.

   The module should export:
   - `coreLifecycleWorkflowDefinitionModule`
   - `coreLifecycleWorkflowMachineModule`
   - deliberate step id constants for steps composed by other modules
   - `_testing` for module id and owned step ids

   The module should not export internal helper functions or action builders unless another module genuinely needs them.

3. Update `coreMaintenance.js` to compose lifecycle steps explicitly.

   Replace raw cross-module lifecycle step strings in maintenance workflows with lifecycle-owned step id constants where that improves ownership clarity.

   Keep maintenance-local ids private unless they are required by tests through `_testing`.

   The maintenance file should remain clean:
   - imports only shared primitives and lifecycle step ids it composes
   - owns only maintenance-specific ids, definitions, workflows, and machines
   - exports only the two module factories and `_testing`

4. Introduce `workflowModules/coreCoding.js`.

   Move these definitions out of `workflow.js`:
   - `seed_application_defined`
   - `issue_file_created`
   - `issue_submitted`
   - `seed_plan_made`
   - `seed_plan_executed`
   - `plan_made`
   - `plan_executed`
   - `implementation_reviewed`
   - `agent_conversation`
   - `deep_ui_check_run`
   - `review_run`
   - `changes_accepted`
   - `report_created`
   - `project_knowledge_updated`

   Move the matching machines out of `workflowStepMachines.js`.

   Move the built-in coding workflow profile ids out of `workflowProfileIds.js` and into `coreCoding.js`.

   Define the current coding workflows in `coreCoding.js`:
   - `seed_application`
   - `big_feature`
   - `general_coding`

   These workflows should compose lifecycle step ids from `coreLifecycle.js` and coding step ids from `coreCoding.js`.

5. Slim down `workflow.js`.

   It should register definition modules in dependency order:
   - lifecycle definitions
   - coding definitions and workflows
   - maintenance definitions and workflows

   After registration, it should only keep:
   - profile normalization
   - workflow lookup
   - public workflow profile creation options
   - compatibility exports that are genuinely public API

   It should not contain concrete step definitions or concrete workflow profile bodies.

6. Slim down `workflowStepMachines.js`.

   It should register machine modules in dependency order:
   - lifecycle machines
   - coding machines
   - maintenance machines

   After registration, it should only keep:
   - `stepMachineForStep`
   - prompt instruction lookup
   - step-machine view application
   - input saving
   - recovery
   - action started/finished recording
   - `STEP_STATUS` re-export

   It should not contain concrete machine implementations for lifecycle, coding, or maintenance steps.

7. Remove the generic core module id from the registry.

   `workflowRegistry.js` should not export `VIBE64_CORE_WORKFLOW_MODULE_ID`.

   Tests should import module ids from each module's `_testing` export instead of from the public registry barrel.

8. Decide what to do with `workflowProfileIds.js`.

   Preferred outcome: remove it after `coreCoding.js` owns the built-in coding workflow profile ids.

   If compatibility requires keeping it briefly, make it a thin re-export with a comment explaining that `coreCoding.js` owns the source of truth.

9. Verify behavior after each vertical move.

   After the lifecycle move, run:
   - `node --test tests/server/vibe64WorkflowMachine.unit.test.js`
   - the impacted session/artifact route tests

   After the coding move, run:
   - `node --test tests/server/vibe64WorkflowMachine.unit.test.js tests/server/vibe64SessionsService.unit.test.js tests/server/vibe64ArtifactsService.unit.test.js tests/server/vibe64SessionsRoutes.unit.test.js`

   Before considering the slice complete, run:
   - `npx jskit app verify`

10. Keep future dynamic modules out of this slice.

    The static module contract should be clean first:
    - modules return `steps`
    - modules return `workflows`
    - workflows are ordered lists of step ids
    - registration fails if a workflow references an unknown step

    Only after lifecycle, coding, and maintenance all follow that shape should we add dynamic loading, dependency sorting, or external module discovery.
