#!/usr/bin/env python3
"""Download a verified public construction-cost publication and write provenance."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

ALLOWED_HOSTS = {
    "moc.gov.vn",
    "kinhtexaydung.gov.vn",
    "vbpl.vn",
    "chinhphu.vn",
    "cantho.gov.vn",
    "soxaydung.cantho.gov.vn",
    "data.cantho.gov.vn",
    "dongthap.gov.vn",
    "sxd.dongnai.gov.vn",
    "hochiminhcity.gov.vn",
    "congbao.hochiminhcity.gov.vn",
    "binhphuoc.gov.vn",
    "google.com",
    "docs.google.com",
    "drive.google.com",
    "googleusercontent.com",
}
MAX_BYTES = 100 * 1024 * 1024


def host_allowed(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == allowed or host.endswith("." + allowed) for allowed in ALLOWED_HOSTS)


def safe_filename(value: str) -> str:
    value = unquote(value).replace("\\", "/").split("/")[-1]
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return (value or "publication.bin")[:160]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Direct public file URL from an official publication page")
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--source-page", required=True, help="Official page that links to the file")
    parser.add_argument("--jurisdiction", required=True)
    parser.add_argument("--publication-no", required=True)
    parser.add_argument("--period", required=True, help="Period, e.g. 2026-08 or 2026-Q3")
    parser.add_argument("--record-type", default="material_price")
    parser.add_argument("--max-mb", type=int, default=100)
    args = parser.parse_args()

    for label, value in (("file URL", args.url), ("source page", args.source_page)):
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or not host_allowed(parsed.hostname):
            parser.error(f"{label} must use HTTPS and an allowlisted official host")
    if args.max_mb < 1 or args.max_mb > 100:
        parser.error("--max-mb must be between 1 and 100")

    limit = min(args.max_mb * 1024 * 1024, MAX_BYTES)
    request = urllib.request.Request(args.url, headers={"User-Agent": "ConstructionCostDataFetcher/1.0"})
    try:
        response = urllib.request.urlopen(request, timeout=90)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} while retrieving source file") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Unable to retrieve source file: {exc.reason}") from exc
    final_url = response.geturl()
    parsed = urlparse(final_url)
    if parsed.scheme != "https" or not parsed.hostname or not host_allowed(parsed.hostname):
        response.close()
        raise RuntimeError("Redirect left HTTPS allowlist; refusing download")
    length = response.headers.get("Content-Length")
    if length and int(length) > limit:
        response.close()
        raise RuntimeError(f"File exceeds configured limit ({length} bytes)")
    disposition = response.headers.get("Content-Disposition", "")
    match = re.search(r"filename\*?=(?:UTF-8''|\"?)([^;\"]+)", disposition, flags=re.I)
    filename = safe_filename(match.group(1).strip() if match else Path(parsed.path).name)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    target_path = args.out_dir / filename
    if target_path.exists():
        response.close()
        raise RuntimeError(f"Refusing to overwrite existing file: {target_path}")

    digest = hashlib.sha256()
    total = 0
    try:
        with target_path.open("xb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise RuntimeError("Streamed file exceeds configured limit")
                digest.update(chunk)
                output.write(chunk)
    except Exception:
        target_path.unlink(missing_ok=True)
        raise
    finally:
        response.close()

    manifest = {
        "record_type": args.record_type,
        "jurisdiction": args.jurisdiction,
        "publication_no": args.publication_no,
        "period": args.period,
        "source_page_url": args.source_page,
        "source_file_url": final_url,
        "source_file_name": filename,
        "downloaded_at_utc": datetime.now(timezone.utc).isoformat(),
        "size_bytes": total,
        "sha256": digest.hexdigest(),
        "content_type": response.headers.get("Content-Type"),
        "verification_note": "Download provenance only; verify issuing body, period, scope, amendments, and file contents separately.",
    }
    manifest_path = target_path.with_suffix(target_path.suffix + ".manifest.json")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"file": str(target_path), "manifest": str(manifest_path), "bytes": total, "sha256": manifest["sha256"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, OSError, RuntimeError) as exc:
        print(f"download error: {exc}", file=sys.stderr)
        raise SystemExit(2)
