import { unref } from "vue";

function readRefOrGetterValue(value) {
  return unref(typeof value === "function" ? value() : value);
}

function readRefOrGetterBoolean(value) {
  return Boolean(readRefOrGetterValue(value));
}

export {
  readRefOrGetterBoolean,
  readRefOrGetterValue
};
