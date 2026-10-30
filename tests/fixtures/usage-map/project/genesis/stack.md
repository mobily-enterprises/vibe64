# Stack

## Components

- `nodejs`

## Architecture layout

### Group `entry`: Entry points
- Kind: `layer`
- Purpose: `Starts the application.`
- Subsystem: `bin`
- Subsystem: `server`

### Group `features`: Features
- Kind: `layer`
- Purpose: `What people use.`
- Subsystem: `src`
- Subsystem: `packages/sessions`
- Subsystem: `packages/reports`

### Group `shared`: Shared code
- Kind: `layer`
- Purpose: `Plumbing every feature uses.`
- Subsystem: `packages/core`
