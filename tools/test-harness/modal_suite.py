# The one-validation suite on a Modal CPU container instead of the laptop (lane OPS2). Driven by remote-suite.sh,
# which stages head.tgz (+ base.tgz, REFS.txt) in $REMOTE_SUITE_SRC; don't run this file by hand.
# Inside: node $REMOTE_SUITE_NODE + pnpm 10.27.0, a fresh `pnpm install --frozen-lockfile`, then
# tools/test-harness/one-validation.sh --skip <skip> (V7 real-Chrome walks and V8 laptop-history boot are skipped by
# default: no GPU, and the production histories live on the laptop). The container has its own network namespace, so
# the test ports can't collide with anything. Returns /out as a tarball that remote-suite.sh unpacks into <outDir>.
import io
import os
import re
import subprocess
import tarfile

import modal

SRC = os.environ.get("REMOTE_SUITE_SRC")
NODE = os.environ.get("REMOTE_SUITE_NODE", "22")

image = (
    modal.Image.from_registry(f"node:{NODE}-bookworm", add_python="3.12")
    .apt_install("git", "perl", "bsdextrautils", "lsof", "procps", "curl", "build-essential")
    .run_commands("corepack enable && corepack prepare pnpm@10.27.0 --activate && pnpm --version")
)
if SRC:
    image = image.add_local_dir(SRC, "/in")

app = modal.App("eden4-remote-suite")

INNER = r"""
set -u
cat /in/REFS.txt
prep() {  # prep <tgz> <dir>: unpack, make it a git repo (one-validation's V0 reads HEAD), install deps
  mkdir -p "$2" && tar xzf "$1" -C "$2" && cd "$2" || return 1
  # The invocation's committed harness tests both source refs with identical rules.
  tar xzf /in/harness.tgz -C "$2" || return 1
  git init -q -b main && git add -A && git -c user.email=suite@local -c user.name=suite commit -qm "$(basename "$2")" || return 1
  if [ -f /in/historical-inputs.pack ]; then
    git index-pack --stdin < /in/historical-inputs.pack || return 1
  fi
  pnpm install --frozen-lockfile > "/out/install-$(basename "$2").log" 2>&1; local rc=$?
  echo "install $(basename "$2") rc=$rc"; tail -n 3 "/out/install-$(basename "$2").log"
  return "$rc"
}
mkdir -p /out
cp /in/RUN-METADATA.json /out/
cp /in/historical-inputs.pack.json /out/ 2>/dev/null || true
prep /in/head.tgz /work/head || exit 1
BASE=none
if [ -f /in/base.tgz ]; then prep /in/base.tgz /work/base || exit 1; BASE=/work/base; fi
node --version; nproc; grep MemTotal /proc/meminfo
bash /work/head/tools/test-harness/one-validation.sh /out/suite --baseline "$BASE" --skip "$SKIP"
rc=$?
python - "$rc" <<'PY'
import json, sys, subprocess
p = '/out/RUN-METADATA.json'
with open(p) as f: data = json.load(f)
data['suiteCompleted'] = sys.argv[1] == '0'
data['suiteExit'] = int(sys.argv[1])
data['nodeVersion'] = subprocess.check_output(['node', '--version'], text=True).strip()
data['pnpmVersion'] = subprocess.check_output(['pnpm', '--version'], text=True).strip()
with open(p, 'w') as f: json.dump(data, f, indent=2)
PY
"""


@app.function(image=image, cpu=8.0, memory=16384, timeout=4 * 3600)
def run(skip: str, server_files: str = "") -> bytes:
    files = server_files.split()
    if any(not re.fullmatch(r"src/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\.test\.ts", f) for f in files):
        raise ValueError("server files must be src/<safe path>/<name>.test.ts")
    subprocess.run(["bash", "-c", INNER], env={**os.environ, "SKIP": skip, "SERVER_TEST_FILES": " ".join(files), "CI": "1", "REMOTE_SUITE_CPU": "1"}, check=False)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        t.add("/out", arcname="out")
    return buf.getvalue()


@app.local_entrypoint()
def main(out: str, skip: str = "V7,V8", server_files: str = ""):
    data = run.remote(skip, server_files)
    os.makedirs(out, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
        try: t.extractall(out, filter="data")
        except TypeError: t.extractall(out)  # Python < 3.12 (no extraction filters); the archive is our own suite output
    print(f"results in {out}/out (SUMMARY: {out}/out/suite/SUMMARY.tsv)")
