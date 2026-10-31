#!/bin/zsh
set -eu
cd "${MARS_CAMPUS_REPO:?set MARS_CAMPUS_REPO to the campus-2026-reconstruction checkout}/viewer"
exec npm run dev -- --host 127.0.0.1 --port 4326
