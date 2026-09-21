import {
  randomUUID
} from "node:crypto";

import {
  vibe64Error
} from "@local/vibe64-core/server/core";

import {
  databaseDialect
} from "./databaseDialect.js";

const QUERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const MAX_QUERY_TEXT_BYTES = 512 * 1024;

function normalizedSql(value = "") {
  const sql = String(value || "").trim();
  if (!sql) {
    throw vibe64Error("Enter a SQL statement to run.", "vibe64_database_query_required");
  }
  if (Buffer.byteLength(sql, "utf8") > MAX_QUERY_TEXT_BYTES) {
    throw vibe64Error(
      "The SQL statement is too large to run in the session database tool.",
      "vibe64_database_query_too_large"
    );
  }
  return sql;
}

function dollarQuoteDelimiterAt(sql = "", index = 0) {
  const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u);
  return match?.[0] || "";
}

function escapedByBackslash(sql = "", index = 0) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && sql[cursor] === "\\"; cursor -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function sqlSegments(sql = "", engine = "postgresql") {
  const dialect = databaseDialect(engine);
  const segments = [];
  let segment = "";
  let state = "normal";
  let dollarDelimiter = "";
  let singleQuoteBackslashEscapes = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1] || "";
    segment += character;

    if (state === "line-comment") {
      if (character === "\n") {
        state = "normal";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        segment += next;
        index += 1;
        state = "normal";
      }
      continue;
    }
    if (state === "single-quote") {
      if (character === "'" && next === "'") {
        segment += next;
        index += 1;
      } else if (
        character === "'" &&
        (!singleQuoteBackslashEscapes || !escapedByBackslash(sql, index))
      ) {
        state = "normal";
      }
      continue;
    }
    if (state === "double-quote") {
      if (character === "\"" && next === "\"") {
        segment += next;
        index += 1;
      } else if (character === "\"") {
        state = "normal";
      }
      continue;
    }
    if (state === "backtick") {
      if (character === "`" && next === "`") {
        segment += next;
        index += 1;
      } else if (character === "`") {
        state = "normal";
      }
      continue;
    }
    if (state === "bracket") {
      if (character === "]") state = "normal";
      continue;
    }
    if (state === "dollar-quote") {
      if (sql.startsWith(dollarDelimiter, index)) {
        segment += dollarDelimiter.slice(1);
        index += dollarDelimiter.length - 1;
        state = "normal";
      }
      continue;
    }

    if (character === "-" && next === "-") {
      segment += next;
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      segment += next;
      index += 1;
      state = "block-comment";
    } else if (character === "'") {
      singleQuoteBackslashEscapes = dialect.singleQuoteBackslashEscapes(sql, index);
      state = "single-quote";
    } else if (character === "\"") {
      state = "double-quote";
    } else if (character === "`") {
      state = "backtick";
    } else if (character === "[" && engine === "sqlite") {
      state = "bracket";
    } else if (character === "$") {
      dollarDelimiter = dollarQuoteDelimiterAt(sql, index);
      if (dollarDelimiter) {
        segment += dollarDelimiter.slice(1);
        index += dollarDelimiter.length - 1;
        state = "dollar-quote";
      }
    } else if (character === ";") {
      segments.push(segment.slice(0, -1));
      segment = "";
    }
  }
  segments.push(segment);
  return segments;
}

function segmentHasSql(segment = "") {
  return String(segment || "")
    .replace(/--[^\n]*(?:\n|$)/gu, " ")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .trim().length > 0;
}

function assertSingleStatement(value = "", engine = "postgresql") {
  const sql = normalizedSql(value);
  const statements = sqlSegments(sql, engine).filter(segmentHasSql);
  if (statements.length !== 1) {
    throw vibe64Error(
      "Run exactly one SQL statement at a time.",
      "vibe64_database_single_statement_required"
    );
  }
  return sql;
}

function queryId(value = "") {
  const candidate = String(value || "").trim() || randomUUID();
  if (!QUERY_ID_PATTERN.test(candidate)) {
    throw vibe64Error("The database query id is invalid.", "vibe64_database_query_id_invalid");
  }
  return candidate;
}

function quoteIdentifier(value = "", engine = "postgresql") {
  return databaseDialect(engine).quoteIdentifier(value);
}

function quoteQualifiedTable(table = {}, engine = "postgresql") {
  return [table.schema, table.name]
    .filter((part) => String(part || "").length > 0)
    .map((part) => quoteIdentifier(part, engine))
    .join(".");
}

export {
  MAX_QUERY_TEXT_BYTES,
  assertSingleStatement,
  queryId,
  quoteIdentifier,
  quoteQualifiedTable,
  sqlSegments
};
