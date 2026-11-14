#!/bin/sh
set -eu
config_dir="${CONFIG_DIR:-/config}"
runtime_uid="${PUID:-1000}"
runtime_gid="${PGID:-1000}"
case "$runtime_uid:$runtime_gid" in *[!0-9:]*|:*|*:) echo 'JellyHub: PUID and PGID must be numeric.' >&2; exit 1;; esac
if [ "$runtime_uid" -eq 0 ] || [ "$runtime_gid" -eq 0 ]; then
  echo 'JellyHub: PUID and PGID must be non-root IDs.' >&2; exit 1
fi
if [ "$(id -u)" = 0 ]; then
  case "$config_dir" in /|/app|/app/|.|'') echo 'JellyHub: CONFIG_DIR must be a dedicated appdata directory.' >&2; exit 1;; esac
  if [ -L "$config_dir" ] || [ -L "$config_dir/settings.json" ]; then
    echo 'JellyHub: config directory and settings.json must not be symlinks.' >&2; exit 1
  fi
  # Repair only the mount root and JellyHub's own settings file, never recursively.
  if ! mkdir -p "$config_dir" || ! chown "$runtime_uid:$runtime_gid" "$config_dir" || ! chmod u+rwx "$config_dir"; then
    echo "JellyHub: cannot initialize $config_dir. Mount JellyHub appdata read/write and allow UID $runtime_uid / GID $runtime_gid to own it." >&2; exit 1
  fi
  if [ -f "$config_dir/settings.json" ]; then
    if ! chown "$runtime_uid:$runtime_gid" "$config_dir/settings.json" || ! chmod 600 "$config_dir/settings.json"; then
      echo "JellyHub: cannot initialize settings.json. Mount JellyHub appdata read/write and check file ownership permissions." >&2; exit 1
    fi
  fi
  exec su-exec "$runtime_uid:$runtime_gid" "$@"
fi
exec "$@"
