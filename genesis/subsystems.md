# Subsystems

## `projects` Project definition

Owns project discovery, the portable collaboration, engineering and deployment
settings, and the project-wide GitHub issue and pull request workflows.

### Program

- `genesis/program/projects/application-deployment.md`
- `genesis/program/projects/catalog.md`
- `genesis/program/projects/collaboration-approach.md`
- `genesis/program/projects/engineering-approach.md`
- `genesis/program/projects/github-issues.md`
- `genesis/program/projects/github-pull-requests.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `sessions` Session workspaces

Owns isolated working sessions, their lifecycle and recoverable workspace history.

### Program

- `genesis/program/sessions/workspaces.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `conversation` Agent conversation

Owns direct conversations and temporary assistance with connected coding agents.
Consumes JSKIT conversation presentation, provider primitives and transcript
policy; Vibe64 owns the adapters, filesystem history, access and execution.
It also owns switching the main conversation between engines, preserving native
identities and adding missed or corrected history to the next ordinary Send.
Temporary conversation discovery and explicit-close cleanup belong here too;
these chats survive view removal and stay separate from main History.

### Program

- `genesis/program/conversation/direct-chat.md`
- `genesis/program/conversation/temporary-assistance.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `accounts` Agent connections

Owns AI account setup, provider-key storage and validation, connection selection,
helper-model preferences and connection health. Standalone and hosted editors
share these operations; hosts supply credential context and access policy.

### Program

- `genesis/program/accounts/connections-and-health.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `execution` Managed execution

Owns workspace preparation, execution resource estimates and workflow accounting.

### Program

- `genesis/program/execution/resource-estimates.md`
- `genesis/program/execution/workflow-accounting.md`
- `genesis/program/execution/workspace-setup.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `preview` Application preview

Owns running project applications and their preview identities.

### Program

- `genesis/program/preview/application-identities.md`
- `genesis/program/preview/managed-application.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `environment` Project environment

Owns project values supplied to managed application work.

### Program

- `genesis/program/environment/project-values.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `source` Source work

Owns editing, reviewing and saving project source changes, including derived
filename and content indexes for each working session.

### Program

- `genesis/program/source/edit-and-review.md`
- `genesis/program/source/save-work.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `database` Database exploration

Owns inspection, diagram exploration, agent-assisted layout changes and query execution for a selected project database.
Its transient copilot consumes the shared JSKIT conversation UI with
server-owned configuration and database-specific actions.

### Program

- `genesis/program/database/diagram-exploration.md`
- `genesis/program/database/query-execution.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `understanding` Project understanding

Owns presenting Genesis explanations, authored subsystems and source Cities.

### Program

- `genesis/program/understanding/genesis-context.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `distribution` Runtime distribution

Owns the shared compact runtime builder, npm artifact preparation, isolated
installation proof, and the complete development preview with its bundled
example project. Hosted consumers supply their private runtime requirements.

### Program

- `genesis/program/operations/runtime-release.md`

### Data owned

- Nothing.

### Data used

- Nothing.
