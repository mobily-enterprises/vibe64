// The project slug rule, shared by the server that enforces it and the
// browser forms that name a project before asking for it.
const PROJECT_SLUG_MAX_LENGTH = 48;
const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;

export {
  PROJECT_SLUG_MAX_LENGTH,
  PROJECT_SLUG_PATTERN
};
