// Whether a value has its own property of this name.
function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

export { hasOwn };
