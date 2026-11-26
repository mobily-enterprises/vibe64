/**
 * A Machine City symbol's source range: `start`, its declaration's start (else its line and column), `end`, and
 * `rangeAvailable`, whether it has an end. Machine City 3 stores `start` only where it differs from the line and
 * column and leaves `rangeAvailable` to follow from `end`; earlier versions store both.
 */
export function genesisSymbolRange(symbol) {
  return {
    start: symbol.start ?? (Number.isSafeInteger(symbol.line) ? { line: symbol.line, column: symbol.column } : undefined),
    end: symbol.end,
    rangeAvailable: symbol.rangeAvailable ?? Boolean(symbol.end)
  };
}
