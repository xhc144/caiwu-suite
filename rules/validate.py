"""Offline schema, provenance, selection and migration validation entry point."""
from pathlib import Path
import json
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rules.runtime import RuleError, validate_bundle


def main() -> int:
    try:
        result = validate_bundle(Path(__file__).resolve().parent)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (RuleError, OSError) as exc:
        print(f"Rule validation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
