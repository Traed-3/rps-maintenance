#!/bin/bash
# Hourly snapshot of Starsky's Master Schedule (the workbook is rewritten daily, so anything not captured is lost):
#   1. sync-master-schedule-log.py  — every Job List row + its W/O / authorizer, kept forever
#   2. import-master-schedule.py    — who goes where each day (con_schedule_entries; replaces today and later only,
#                                     so past days keep their record)
# Run by ~/Library/LaunchAgents/com.rps.master-schedule-sync.plist (see scripts/com.rps.master-schedule-sync.plist).
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HOME/Library/CloudStorage/Dropbox-RP/Construction Department/1-Master Schedule/1 - Schedule/1 - Master schedule .xlsm"
PY=/usr/bin/python3
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
if [ ! -f "$SRC" ]; then echo "Master schedule not found: $SRC"; exit 1; fi
# Read a copy — Excel/Dropbox may be writing the original.
cp "$SRC" "$WORK/ms.xlsm" || { echo "Could not copy the workbook (Dropbox still syncing?)"; exit 1; }

"$PY" "$REPO/scripts/sync-master-schedule-log.py" "$WORK/ms.xlsm" --apply || echo "!! schedule log sync failed"
"$PY" "$REPO/scripts/import-master-schedule.py" "$WORK/ms.xlsm" --apply | tail -3 || echo "!! day-plan import failed"
