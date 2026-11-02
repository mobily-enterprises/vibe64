// How the database workspace writes dates, statements and cell values as text, and reads a typed cell value back.

/**
 * A stored time as a short local date and time, "never" when there is none, or the stored text when it is not a date.
 * @param {string | undefined} value
 * @returns {string}
 */
function shortDate(value) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The first line of a SQL statement, at most 80 characters, as its label in a list.
 * @param {string | undefined} value
 * @returns {string}
 */
function firstSqlLine(value) {
  return String(value || "").trim().split("\n")[0].slice(0, 80) || "SQL statement";
}

/**
 * A query result value as the text a cell shows: NULL for null, JSON for an object or array.
 * @param {unknown} value
 * @returns {string}
 */
function displayValue(value) {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Text a person typed for a cell, as the value to write. A number or boolean keeps the type of the value it
 * replaces; an object, or an array or object typed into a JSON column, is parsed as JSON.
 * @param {string} text
 * @param {unknown} original the cell's current value
 * @param {{ databaseType?: string }} [column]
 * @returns {unknown}
 */
function parsedValue(text, original, column = {}) {
  if (typeof original === "number") {
    const number = Number(text);
    if (!Number.isFinite(number)) throw new Error("Enter a valid number.");
    return number;
  }
  if (typeof original === "boolean") {
    if (!/^(?:true|false)$/iu.test(text.trim())) throw new Error("Enter true or false.");
    return text.trim().toLowerCase() === "true";
  }
  if (original && typeof original === "object") return JSON.parse(text);
  if (
    /json/iu.test(column.databaseType || "") &&
    (text.trim().startsWith("[") || text.trim().startsWith("{"))
  ) return JSON.parse(text);
  return text;
}

export {
  displayValue,
  firstSqlLine,
  parsedValue,
  shortDate
};
