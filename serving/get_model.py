"""
get_model.py
============
Download the trained checkpoint that this system needs to run.

    python serving/get_model.py

Why the model is not in the repository
--------------------------------------
The checkpoint is ~1.1 GB, and its largest single file is 1068 MB. GitHub
rejects any file over 100 MB in ordinary git, so committing it is not
possible — the push fails. Git LFS could carry it, but 1.1 GB exceeds the free
1 GB quota.

It ships as a GitHub Release asset instead: free, versioned alongside the tag,
2 GB per-file limit, and it does not bloat the git history the way a large
binary does (git keeps every version of a committed file forever).

So the setup is `git pull` plus this one command, rather than `git pull` alone.

What happens without it
-----------------------
The web app does NOT crash. js/bert-api.js falls back to the keyword scorer in
js/mock-bert.js and the UI looks entirely healthy — while running a markedly
worse classifier that rated "May naipit na tao sa pinto" (a person trapped in a
door) at 38/low. That silent degradation is the reason this script verifies
what it downloaded instead of trusting it.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL_DIR = HERE / "model"
ARCHIVE = HERE / "firs-model-f7-fp16.zip"

OWNER = "EnzoProg-ctrl"
REPO = "Thesis-Autofill"
RELEASE_TAG = "model-v1"
ASSET = "firs-model-f7-fp16.zip"
URL = (f"https://github.com/{OWNER}/{REPO}/releases/download/"
       f"{RELEASE_TAG}/{ASSET}")

# Verified against the fp32 checkpoint over all 1788 test rows: 0 category and
# 1 priority prediction differed. A truncated download does NOT crash on load —
# it produces confident nonsense — so this hash is the only thing standing
# between a bad transfer and wrong triage in production.
SHA256 = "9737fefafa06555bf0add1361f8fdbb7d20f70127f6d0689f2a65105a3df8325"

EXPECTED = ["meta.json", "label_map.json", "priority_map.json",
            "head.pt", "priority_head.pt", "backbone/model.safetensors"]


def _progress(done: int, total: int) -> None:
    if total <= 0:
        return
    pct = 100 * done / total
    bar = "#" * int(pct / 2.5)
    sys.stdout.write(f"\r  [{bar:<40}] {pct:5.1f}%  {done/1e6:.0f}/{total/1e6:.0f} MB")
    sys.stdout.flush()


def _asset_url() -> tuple[str, dict]:
    """Resolve the download URL, authenticating if this is a private repo.

    Thesis-Autofill is PRIVATE, so the public browser_download_url returns 404
    to anyone unauthenticated — including teammates who can see the release
    perfectly well in their browser. For private repos the asset must be
    fetched through the API by its numeric id, with a token and an
    octet-stream Accept header.

    Set GITHUB_TOKEN to a classic token with `repo` scope, or a fine-grained
    token with read access to this repository:
        https://github.com/settings/tokens
    """
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        return URL, {}

    api = (f"https://api.github.com/repos/{OWNER}/{REPO}/releases/tags/"
           f"{RELEASE_TAG}")
    req = urllib.request.Request(api, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "firs-get-model",
    })
    with urllib.request.urlopen(req) as r:
        rel = json.load(r)
    for a in rel.get("assets", []):
        if a["name"] == ASSET:
            return a["url"], {
                "Authorization": f"Bearer {token}",
                "Accept": "application/octet-stream",
                "User-Agent": "firs-get-model",
            }
    sys.exit(f"Release {RELEASE_TAG} exists but has no asset named {ASSET}.")


def download() -> None:
    url, headers = _asset_url()
    auth = " (authenticated)" if headers else ""
    print(f"downloading {ASSET} (~1.1 GB){auth}")
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as r, open(ARCHIVE, "wb") as f:
            total = int(r.headers.get("Content-Length", 0))
            done = 0
            while chunk := r.read(1 << 20):
                f.write(chunk)
                done += len(chunk)
                _progress(done, total)
        print()
    except Exception as exc:                              # noqa: BLE001
        ARCHIVE.unlink(missing_ok=True)
        sys.exit(
            f"\nDownload failed: {exc}\n\n"
            f"This repository is PRIVATE, so the download needs authentication.\n"
            f"Two options:\n\n"
            f"  A) Set a token and re-run:\n"
            f"       GITHUB_TOKEN=ghp_xxx python serving/get_model.py\n"
            f"     Create one at https://github.com/settings/tokens with `repo`\n"
            f"     scope (classic) or read access to this repo (fine-grained).\n\n"
            f"  B) Download it in your browser — you are already signed in:\n"
            f"       https://github.com/{OWNER}/{REPO}/releases/tag/{RELEASE_TAG}\n"
            f"     Save it as:\n       {ARCHIVE}\n"
            f"     then re-run this script. It will verify and extract the\n"
            f"     local file without downloading anything."
        )


def main() -> int:
    if MODEL_DIR.exists() and all((MODEL_DIR / f).exists() for f in EXPECTED):
        print(f"model already present at {MODEL_DIR} — nothing to do.")
        print("  (delete that directory and re-run to force a fresh download)")
        return 0

    if not ARCHIVE.exists():
        download()

    print("verifying checksum ...")
    h = hashlib.sha256()
    with open(ARCHIVE, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    if h.hexdigest() != SHA256:
        ARCHIVE.unlink(missing_ok=True)
        sys.exit(f"  CHECKSUM MISMATCH\n    expected {SHA256}\n    got      "
                 f"{h.hexdigest()}\n  The download was corrupted or truncated. "
                 f"Deleted it; re-run to try again.")
    print("  ok")

    print("extracting ...")
    if MODEL_DIR.exists():
        shutil.rmtree(MODEL_DIR)
    with zipfile.ZipFile(ARCHIVE) as z:
        z.extractall(HERE)

    missing = [f for f in EXPECTED if not (MODEL_DIR / f).exists()]
    if missing:
        sys.exit(f"  archive extracted but these are missing: {missing}")

    size = sum(f.stat().st_size for f in MODEL_DIR.rglob("*") if f.is_file())
    print(f"  model ready at {MODEL_DIR}  ({size/1e9:.2f} GB)")
    ARCHIVE.unlink(missing_ok=True)
    print("\nNext:\n  cd serving && python serve.py\n"
          "  curl http://127.0.0.1:8000/health")
    return 0


if __name__ == "__main__":
    sys.exit(main())
