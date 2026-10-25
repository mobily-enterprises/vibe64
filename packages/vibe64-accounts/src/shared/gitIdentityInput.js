function validateGitIdentityInputs(inputs = {}) {
  const name = String(inputs.name || "").trim();
  const email = String(inputs.email || "").trim();
  if (!name) {
    return { ok: false, error: "Git user.name is required." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return { ok: false, error: "Git user.email must be a valid email address." };
  }
  return { email, name, ok: true };
}

export { validateGitIdentityInputs };
