# @local/vibe64-core

Shared Vibe64 server primitives.

This package is intentionally small. It owns reusable infrastructure that
multiple Vibe64 feature packages need, such as route helpers, response
normalization, session realtime event descriptors, and terminal websocket
plumbing.

Feature behavior stays in the feature packages that use these helpers.
