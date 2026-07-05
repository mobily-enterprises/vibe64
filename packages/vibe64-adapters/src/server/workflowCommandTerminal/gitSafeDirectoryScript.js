function gitSafeDirectoryEnvironmentScript(pathExpressions = []) {
  const additions = pathExpressions.map((expression) => `  vibe64_add_git_safe_directory ${expression}`);
  return [
    "vibe64_configure_git_safe_directories() {",
    "  vibe64_git_config_index=\"${GIT_CONFIG_COUNT:-0}\"",
    "  vibe64_add_git_safe_directory() {",
    "    if [ -z \"$1\" ]; then",
    "      return 0",
    "    fi",
    "    printf -v \"GIT_CONFIG_KEY_${vibe64_git_config_index}\" '%s' safe.directory",
    "    printf -v \"GIT_CONFIG_VALUE_${vibe64_git_config_index}\" '%s' \"$1\"",
    "    export \"GIT_CONFIG_KEY_${vibe64_git_config_index}\" \"GIT_CONFIG_VALUE_${vibe64_git_config_index}\"",
    "    vibe64_git_config_index=$((vibe64_git_config_index + 1))",
    "    export GIT_CONFIG_COUNT=\"$vibe64_git_config_index\"",
    "  }",
    ...additions,
    "}",
    "vibe64_configure_git_safe_directories"
  ].join("\n");
}

export {
  gitSafeDirectoryEnvironmentScript
};
