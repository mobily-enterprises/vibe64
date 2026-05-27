#!/usr/bin/env bash

vibe64_config_dir() {
  printf '%s\n' "${VIBE64_CONFIG_DIR:-}"
}

vibe64_config_path() {
  local name="${1:-}"
  case "$name" in
    ''|*/*|*'..'*)
      return 2
      ;;
  esac
  local dir
  dir="$(vibe64_config_dir)"
  if [ -z "$dir" ]; then
    return 2
  fi
  printf '%s/%s\n' "$dir" "$name"
}

vibe64_config_value() {
  local name="${1:-}"
  local default_value="${2:-}"
  local file_path
  file_path="$(vibe64_config_path "$name")" || {
    printf '%s\n' "$default_value"
    return 0
  }
  if [ ! -f "$file_path" ]; then
    printf '%s\n' "$default_value"
    return 0
  fi
  head -n 1 "$file_path" | sed 's/[[:space:]]*$//'
}

vibe64_config_bool() {
  local value
  value="$(vibe64_config_value "${1:-}" "${2:-false}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

vibe64_config_is() {
  [ "$(vibe64_config_value "${1:-}" "")" = "${2:-}" ]
}
