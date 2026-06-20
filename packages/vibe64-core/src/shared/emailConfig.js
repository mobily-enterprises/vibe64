function vibe64EmailConfig(values = {}) {
  return {
    fromEmail: String(values?.fromEmail ?? "").trim(),
    fromName: String(values?.fromName ?? "").trim(),
    smtpHost: String(values?.smtpHost ?? "").trim(),
    smtpPassword: String(values?.smtpPassword ?? ""),
    smtpPort: String(values?.smtpPort ?? "").trim(),
    smtpUser: String(values?.smtpUser ?? "").trim()
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
