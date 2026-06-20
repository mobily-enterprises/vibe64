function vibe64EmailConfig(values = {}) {
  const password = values?.smtpPassword ?? values?.password ?? "";
  return {
    fromEmail: String(values?.fromEmail ?? "").trim(),
    fromName: String(values?.fromName ?? "").trim(),
    smtpHost: String(values?.smtpHost ?? values?.host ?? "").trim(),
    smtpPassword: String(password),
    smtpPort: String(values?.smtpPort ?? values?.port ?? "").trim(),
    smtpUser: String(values?.smtpUser ?? values?.username ?? "").trim()
  };
}

function vibe64EmailSmtpReady(emailConfig = {}) {
  return Boolean(
    String(emailConfig.fromEmail || "").trim() &&
    String(emailConfig.smtpHost || "").trim() &&
    String(emailConfig.smtpPassword || "").trim() &&
    String(emailConfig.smtpPort || "").trim() &&
    String(emailConfig.smtpUser || "").trim()
  );
}

export {
  vibe64EmailConfig,
  vibe64EmailSmtpReady
};
