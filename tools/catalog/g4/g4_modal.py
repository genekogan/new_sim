# G4 on Modal (Gene, Q9 follow-up: Modal GPU spend approved to catch up the initial renders; G4 is a continuous gate).
# Runs tools/catalog/g4/g4-render.mjs unchanged inside a GPU container with Google Chrome, and copies the report,
# contact sheet and PNGs back to .lane/g4/modal-<stamp>/. The script itself refuses software rendering, so a container
# whose Chrome falls back to SwiftShader exits 3 instead of producing pictures.
#
#   tools/catalog/g4/bundle.sh /tmp/g4-bundle.tar.gz          # tracked tree + apps/web/dist (~70 MB)
#   modal run tools/catalog/g4/g4_modal.py --bundle /tmp/g4-bundle.tar.gz --sample 20 [--items eden/chair@1,...] [--gpu L4]
#
# Auth: uses the Modal CLI's active profile (never read or print its token file). Cost: an L4 is ~$0.80/h; 20 items
# x ~4 variants x 4 views takes a few minutes, so a run is cents; the image builds once and is cached.
import io, os, subprocess, tarfile, time, pathlib, sys
import modal

GPU = os.environ.get("G4_GPU", "L4")
image = (
    modal.Image.from_registry("node:22-bookworm", add_python="3.12")
    .apt_install("curl", "ca-certificates", "gnupg", "fonts-liberation", "libvulkan1", "libegl1", "libgl1", "xz-utils")
    .run_commands(
        "curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt-get install -y /tmp/chrome.deb && rm /tmp/chrome.deb",
        "npm i -g pnpm@10.27.0",
    )
    .env({"NVIDIA_DRIVER_CAPABILITIES": "all"})
)
app = modal.App("eden-catalog-g4", image=image)


@app.function(gpu=GPU, timeout=6000, memory=8192, cpu=4)
def render(bundle: bytes, argv: list[str]) -> bytes:
    os.makedirs("/repo", exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(bundle), mode="r:gz") as t:
        t.extractall("/repo", filter="data")
    subprocess.run("pnpm install --no-frozen-lockfile --ignore-scripts >/tmp/install.log 2>&1 || (tail -40 /tmp/install.log; exit 1)", shell=True, cwd="/repo", check=True)
    subprocess.run("nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || true", shell=True)
    full = "--all" in argv
    argv = [a for a in argv if a != "--all"]
    cmd = ["node", "tools/catalog/g4/g4-batch.mjs" if full else "tools/catalog/g4/g4-render.mjs", "--port", "6102", "--no-lease", "--chrome", "/usr/bin/google-chrome", "--out", "/tmp/g4", *argv]
    try:
        # Full catchup has ~12k views; cap GPU residence at 90 minutes (a few dollars on L4).
        r = subprocess.run(cmd, cwd="/repo", timeout=5400 if full else 3000)
        code = r.returncode
    except subprocess.TimeoutExpired:
        # Preserve the last completed coverage report; the timeout must not look like a passing run.
        code = 3
        print("G4 exceeded render time budget; preserving incomplete evidence", flush=True)
    if code:
        log = pathlib.Path("/tmp/g4/server.log")
        if log.exists():
            print(log.read_text()[-8000:], flush=True)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        if os.path.isdir("/tmp/g4"):
            t.add("/tmp/g4", arcname="g4")
        info = tarfile.TarInfo("g4/exit-code"); data = str(code).encode(); info.size = len(data); t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


@app.local_entrypoint()
def main(bundle: str, sample: int = 20, items: str = "", out: str = "", angle: str = "vulkan", all: bool = False, batch_jobs: int = 72, defs: str = "", variants: str = "", busy: int = 0):
    argv = ["--all", "--batch-jobs", str(batch_jobs)] if all else (["--items", items] if items else ["--sample", str(sample)])
    if all and items:
        argv += ["--items", items]
    if defs:
        if all:
            raise ValueError("candidate --defs uses the single-item renderer, not full core catchup")
        candidate = pathlib.PurePosixPath(defs)
        if candidate.is_absolute() or ".." in candidate.parts:
            raise ValueError("--defs must name a reviewed file inside the bundle")
        argv = ["--defs", defs] + (["--items", items] if items else [])
    argv += ["--angle", angle]
    if variants:
        if all:
            raise ValueError('--variants is a targeted regression option, not full catchup')
        argv += ["--variants", variants]
    if busy:
        if all:
            raise ValueError('--busy is a targeted regression option, not full catchup')
        argv += ["--busy", str(busy)]
    stamp = time.strftime("%Y-%m-%dT%H-%M-%S")
    dest = pathlib.Path(out or f".lane/g4/modal-{stamp}")
    t0 = time.time()
    data = render.remote(pathlib.Path(bundle).read_bytes(), argv)
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
        # Local Modal CLI can still use Python 3.11.0, before extraction filters were backported.
        # Results contain regular files/directories only; refuse links and traversal before the compatibility path.
        for member in t.getmembers():
            target = (dest / member.name).resolve()
            if not target.is_relative_to(dest.resolve()) or not (member.isfile() or member.isdir()):
                raise ValueError(f"unsafe G4 result member: {member.name}")
        try:
            t.extractall(dest, filter="data")
        except TypeError:
            t.extractall(dest)
    print(f"G4 on Modal ({GPU}): {time.time() - t0:.0f} s; results in {dest}/g4 (exit {(dest / 'g4' / 'exit-code').read_text()})")
    sys.exit(int((dest / "g4" / "exit-code").read_text()))
