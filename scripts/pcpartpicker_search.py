#!/usr/bin/env python3
import argparse
import json
import re
from typing import Any, Dict, List, Optional

try:
    from pcpartpicker import API  # type: ignore
except Exception:
    print(json.dumps({"results": []}))
    raise SystemExit(0)


CATEGORY_MAP = {
    "cpu": "cpu",
    "gpu": "video-card",
    "ram": "memory",
    "storage": "internal-hard-drive",
    "motherboard": "motherboard",
    "psu": "power-supply",
    "case": "case",
    "cooler": "cpu-cooler",
    "monitor": "monitor",
    "keyboard": "keyboard",
    "mouse": "mouse",
}

DEFAULT_PARTS = [
    "cpu",
    "video-card",
    "memory",
    "internal-hard-drive",
    "motherboard",
    "power-supply",
    "case",
    "cpu-cooler",
    "monitor",
    "keyboard",
    "mouse",
    "headphones",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--category", default="")
    parser.add_argument("--limit", type=int, default=20)
    return parser.parse_args()


def part_to_category(part: str) -> str:
    reverse = {
        "video-card": "gpu",
        "internal-hard-drive": "storage",
        "power-supply": "psu",
        "cpu-cooler": "cooler",
        "headphones": "other",
    }
    return reverse.get(part, part)


def normalize_price(value: Any) -> Optional[float]:
    if isinstance(value, (float, int)):
        return float(value)
    if isinstance(value, str):
        m = re.search(r"([0-9]+(?:\.[0-9]+)?)", value.replace(",", ""))
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                return None
    return None


def normalize_spec_key(key: str) -> str:
    return key.replace("_", " ").strip()


def normalize_spec_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        pieces = [normalize_spec_value(item) for item in value]
        return ", ".join([p for p in pieces if p])
    if isinstance(value, dict):
        # Handle common typed payloads from pcpartpicker API.
        if "cycles" in value and isinstance(value.get("cycles"), (int, float)):
            ghz = float(value["cycles"]) / 1_000_000_000
            return f"{ghz:.2f} GHz"
        if "total" in value and isinstance(value.get("total"), (int, float)):
            total = float(value["total"])
            if total >= 1_000_000_000:
                return f"{total / 1_000_000_000:.1f} GB"
            if total >= 1_000_000:
                return f"{total / 1_000_000:.1f} MB"
            return str(int(total))
        pieces = []
        for k, v in value.items():
            nested = normalize_spec_value(v)
            if nested:
                pieces.append(f"{normalize_spec_key(str(k))}: {nested}")
        return ", ".join(pieces)
    return str(value)


def build_specs(row: Dict[str, Any]) -> Dict[str, str]:
    blocked = {
        "brand",
        "model",
        "name",
        "title",
        "price",
        "url",
        "link",
        "image",
        "image_url",
        "img",
    }
    specs: Dict[str, str] = {}
    for raw_key, raw_value in row.items():
        key = str(raw_key).strip()
        if not key or key in blocked:
            continue
        normalized = normalize_spec_value(raw_value)
        if not normalized:
            continue
        specs[normalize_spec_key(key)] = normalized
    return specs


def extract_rows(payload: Any) -> List[Dict[str, Any]]:
    if payload is None:
        return []
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            return []
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        # Library shape: {"video-card": [ ... rows ... ]}
        for value in payload.values():
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)]
        for key in ("data", "results", "parts", "items", "rows"):
            child = payload.get(key)
            if isinstance(child, list):
                return [x for x in child if isinstance(x, dict)]
        return [payload]
    return []


def get_brand(name: str, row: Dict[str, Any]) -> str:
    for key in ("manufacturer", "brand", "vendor"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    pieces = name.split(" ")
    return pieces[0] if pieces else "Unknown"


def to_component(row: Dict[str, Any], part: str) -> Optional[Dict[str, Any]]:
    brand_value = str(row.get("brand") or row.get("manufacturer") or row.get("vendor") or "").strip()
    model_value = str(row.get("model") or row.get("name") or row.get("title") or "").strip()
    name = f"{brand_value} {model_value}".strip() if model_value else brand_value
    if not name:
        return None
    specs = build_specs(row)

    suggested = None
    source_price_text = None
    for price_key in ("price", "price_usd", "lowest_price"):
        price_value = row.get(price_key)
        if isinstance(price_value, list) and len(price_value) >= 2:
            source_price_text = f"{price_value[0]} {price_value[1]}"
        elif isinstance(price_value, str):
            source_price_text = price_value
        suggested = normalize_price(price_value)
        if suggested is not None:
            break

    image_url = row.get("image") or row.get("image_url") or row.get("img")
    external_url = row.get("url") or row.get("link")

    return {
        "name": name,
        "brand": brand_value or get_brand(name, row),
        "model": model_value or None,
        "category": part_to_category(part),
        "specs": specs,
        "imageUrl": image_url if isinstance(image_url, str) else None,
        "externalUrl": external_url if isinstance(external_url, str) else None,
        "suggestedPrice": suggested,
        "sourcePriceText": source_price_text,
    }


def main() -> None:
    args = parse_args()
    q = args.query.strip().lower()
    if len(q) < 2:
        print(json.dumps({"results": []}))
        return
    terms = [t for t in re.split(r"\s+", q) if t]

    api = API()
    selected_part = CATEGORY_MAP.get(args.category.strip().lower(), "")
    parts_to_scan = [selected_part] if selected_part else DEFAULT_PARTS

    scored: List[Dict[str, Any]] = []
    for part in parts_to_scan:
        try:
            part_data = api.retrieve(part)
            payload = part_data.to_json() if hasattr(part_data, "to_json") else part_data
            rows = extract_rows(payload)
            for row in rows:
                haystack = json.dumps(row, ensure_ascii=False).lower()
                score = sum(1 for term in terms if term in haystack)
                if score <= 0:
                    continue
                component = to_component(row, part)
                if component:
                    scored.append({"score": score, "component": component})
        except Exception:
            continue

    scored.sort(
        key=lambda entry: (
            int(entry.get("score", 0)),
            float(entry.get("component", {}).get("suggestedPrice") or 0),
        ),
        reverse=True,
    )
    deduped: List[Dict[str, Any]] = []
    seen: set = set()
    for entry in scored:
        component = entry.get("component")
        if not isinstance(component, dict):
            continue
        key = f"{component.get('brand','')}|{component.get('name','')}".lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(component)
        if len(deduped) >= args.limit:
            break

    print(json.dumps({"results": deduped}))


if __name__ == "__main__":
    main()
