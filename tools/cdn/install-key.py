#!/usr/bin/env python3
"""Human-only secret entry. Never run this through an agent or paste keys in chat."""
import getpass
import os
from pathlib import Path
import re
import sys


def main():
    if not sys.stdin.isatty():
        raise SystemExit('Run this command directly in your terminal; hidden prompts require a TTY.')
    if len(sys.argv) != 2 or not Path(sys.argv[1]).is_absolute():
        raise SystemExit('usage: python3 tools/cdn/install-key.py /absolute/path/eden-assets-r2.env')
    target = Path(sys.argv[1])
    if target.exists() or target.is_symlink():
        raise SystemExit('Destination exists; refusing to open or replace a credential file.')
    access = getpass.getpass('R2 Access Key ID (hidden): ')
    secret = getpass.getpass('R2 Secret Access Key (hidden): ')
    if not all(re.fullmatch(r'[A-Za-z0-9+/=_-]+', v) for v in (access, secret)):
        raise SystemExit('Invalid or empty value; nothing written.')
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w', encoding='utf8') as f:
        f.write(f'R2_ACCESS_KEY_ID={access}\nR2_SECRET_ACCESS_KEY={secret}\n')
        f.flush()
        os.fsync(f.fileno())
    os.chmod(target, 0o600)
    print(f'Installed {target} (0600); values were not displayed.')


if __name__ == '__main__':
    main()
