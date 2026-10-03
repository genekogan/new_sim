#!/bin/zsh
set -eu
cd <mars-campus-repo>/viewer
exec npm run dev -- --host 127.0.0.1 --port 4326
