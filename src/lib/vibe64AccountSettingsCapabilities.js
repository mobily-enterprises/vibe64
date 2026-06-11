function supabaseAccountControlsEnabled(runtime = null) {
  const capabilities = runtime?.capabilities || {};
  if (Object.hasOwn(capabilities, "supabaseAccountManagementEnabled")) {
    return capabilities.supabaseAccountManagementEnabled === true;
  }
  return true;
}

export {
  supabaseAccountControlsEnabled
};
