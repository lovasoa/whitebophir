#!/usr/bin/env bash

set -eu

BOARD_DIR="${WBO_BOARD_DIR:-/root/wbo-boards}"
MAX_GIB="${WBO_MAX_BOARD_STORAGE_GIB:-15}"
DRY_RUN="${WBO_DELETE_OLD_BOARDS_DRY_RUN:-0}"

if [ ! -d "$BOARD_DIR" ]; then
  echo "board dir not found: $BOARD_DIR" >&2
  exit 1
fi

target_bytes=$((MAX_GIB * 1024 * 1024 * 1024))
current_bytes="$(du -s --bytes "$BOARD_DIR" | awk '{ print $1 }')"
target_gb="$(awk "BEGIN { printf \"%.1f\", $target_bytes / 1000000000 }")"
current_gb="$(awk "BEGIN { printf \"%.1f\", $current_bytes / 1000000000 }")"

if [ "$current_bytes" -le "$target_bytes" ]; then
  echo "board storage already under limit: ${current_gb}GB <= ${target_gb}GB"
  exit 0
fi

deleted_files=0
deleted_bytes=0

while IFS= read -r -d '' entry; do
  size_and_path="${entry#* }"
  file_size="${size_and_path%% *}"
  file_path="${size_and_path#* }"

  if [ "$DRY_RUN" = "1" ]; then
    echo "would delete $file_path"
  else
    rm -f -- "$file_path"
    echo "deleted $file_path"
  fi

  current_bytes=$((current_bytes - file_size))
  deleted_files=$((deleted_files + 1))
  deleted_bytes=$((deleted_bytes + file_size))

  if [ "$current_bytes" -le "$target_bytes" ]; then
    break
  fi
done < <(find "$BOARD_DIR" -maxdepth 1 -type f -printf '%T@ %s %p\0' | sort -z -n)

deleted_gb="$(awk "BEGIN { printf \"%.1f\", $deleted_bytes / 1000000000 }")"
current_gb="$(awk "BEGIN { printf \"%.1f\", $current_bytes / 1000000000 }")"
echo "deleted_files=$deleted_files deleted_gb=$deleted_gb current_gb=$current_gb target_gb=$target_gb dry_run=$DRY_RUN"
