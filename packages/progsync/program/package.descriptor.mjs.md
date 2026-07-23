# Vibe64 ProgSync package descriptor

Declares the temporary Vibe64 package boundary without participating in runtime
synchronization.

## Uses

- Nothing outside this file.

## Provides

### `default`

The default export is the immutable [Vibe64 package descriptor]. Every nested
field uses the exact shape and literal defined by that type; no legacy
descriptor aliases are emitted.
