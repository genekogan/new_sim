"""Where the Mars media and campus repo live. Neither is part of this repo, so every script that reads or writes them
takes its location from the environment and stops with a clear message when it is unset:

  MARS_ROOT         the Mars folder holding docs/media and code/campus-2026-reconstruction
  MARS_MEDIA_DIR    the media folder (default: $MARS_ROOT/docs/media)
  MARS_CAMPUS_REPO  the campus-2026-reconstruction checkout (default: $MARS_ROOT/code/campus-2026-reconstruction)
"""
import os
import pathlib
import sys


def _env(name, fallback=None):
    value = os.environ.get(name)
    if value:
        return pathlib.Path(value).expanduser()
    if fallback is not None:
        return fallback()
    sys.exit(f'set {name}; mars/scripts/_paths.py lists the Mars path variables')


def mars_root():
    return _env('MARS_ROOT')


def media(sub=''):
    return _env('MARS_MEDIA_DIR', lambda: mars_root() / 'docs/media') / sub


def campus_repo():
    return _env('MARS_CAMPUS_REPO', lambda: mars_root() / 'code/campus-2026-reconstruction')


def env_path(name, what):
    value = os.environ.get(name)
    if not value:
        sys.exit(f'set {name} to {what}')
    return pathlib.Path(value).expanduser()
