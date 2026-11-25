"""Build the managed product identity index from a pinned Nango registry, using PyYAML."""
import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

import yaml

revision = "478e2f6ce880441f754bf418548a93a2fd2e3855"
digest = "603d1dbbbe25c3c3b6b417adb115c2a9891b30d199b03711d89183434264562b"
source = f"https://raw.githubusercontent.com/NangoHQ/nango/{revision}/packages/providers/providers.yaml"
out = Path(__file__).resolve().parents[1] / "lib/connectors/managed-product-identities.json"
auth_modes = {"API_KEY", "OAUTH2", "OAUTH2_CC", "BASIC", "OAUTH1", "TWO_STEP", "APP", "JWT"}
categories = set("accounting analytics ats banking cms communication crm design dev-tools e-commerce erp hr iam invoicing knowledge-base legal marketing payment productivity storage support surveys ticketing video".split())


def normalise(name):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", name).lower())


def identity(row):
    name = row.get("display_name", "").partition(" (")[0].strip()
    url = row.get("proxy", {}).get("base_url", "")
    if not name or not isinstance(url, str) or not url.startswith("https://"):
        return None
    host = urlsplit(url.partition(" || ")[0]).hostname or ""
    if not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", host):
        return None
    return normalise(name), host


def build(rows):
    anchors = defaultdict(list)
    for slug, row in rows.items():
        ident = identity(row)
        if (ident and normalise(slug) == ident[0] and row.get("auth_mode") in auth_modes
                and set(row.get("categories", ())) & categories and not row.get("alias")
                and not row.get("deprecated")):
            anchors[ident[1]].append(slug)
    # Ambiguous shared API hosts need a maintained manual mapping.
    products = {host: slugs[0] for host, slugs in anchors.items() if len(slugs) == 1}
    families = defaultdict(list)
    for slug, row in sorted(rows.items()):
        ident = identity(row)
        if not ident or row.get("auth_mode") not in auth_modes or row.get("deprecated"):
            continue
        product = products.get(ident[1])
        if product and normalise(product) == ident[0]:
            families[product].append(slug)
    return dict(sorted(families.items()))


if __name__ == "__main__":
    if len(sys.argv) == 2:
        raw = Path(sys.argv[1]).read_bytes()
    else:
        with urlopen(source, timeout=30) as response:
            raw = response.read(5_000_001)
    if hashlib.sha256(raw).hexdigest() != digest:
        raise SystemExit("Provider registry differs from the pinned source")
    families = build(yaml.safe_load(raw))
    entries = ",\n".join("    " + json.dumps(k) + ": " + json.dumps(v) for k, v in families.items())
    out.write_text('{\n  "source": ' + json.dumps(source) + ',\n  "sha256": ' + json.dumps(digest) +
                   ',\n  "families": {\n' + entries + '\n  }\n}\n')
