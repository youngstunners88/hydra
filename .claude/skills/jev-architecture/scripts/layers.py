"""Enforce a package dependency rule from data. Python and TypeScript.

Deny by default: an import from package A to package B is legal only if B is
in A's allow-list, and a package missing from the rules may import nothing
in-repo. Relative imports that climb into a sibling package are caught -- the
form that slips past review because it does not look like a dependency.

Rules file: {"packages_dir": "packages", "allow": {"core": [], "hunter": ["core"]}}

Usage: python3 layers.py <repo root> <rules.json>
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

__all__ = ["Violation", "check", "imports_of"]

_TS = re.compile(r"""(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']""")
_PY_FROM = re.compile(r"^\s*from\s+(\.*[\w.]*)\s+import\s", re.M)
_PY_IMPORT = re.compile(r"^\s*import\s+([\w.]+)", re.M)


@dataclass(frozen=True)
class Violation:
    file: str
    source: str
    target: str
    spec: str


def imports_of(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix == ".py":
        return _PY_FROM.findall(text) + _PY_IMPORT.findall(text)
    return _TS.findall(text)


def _target(root: Path, pkgs: Path, file: Path, spec: str, scope: str, names: set[str]) -> str | None:
    if file.suffix == ".py":
        if spec.startswith("."):
            dots = len(spec) - len(spec.lstrip("."))
            base = file.parent
            for _ in range(dots - 1):
                base = base.parent
            rest = spec.lstrip(".")
            resolved = base.joinpath(*rest.split(".")) if rest else base
        else:
            head = spec.split(".")[0]
            return head if head in names else None
    else:
        if spec.startswith(scope):
            return spec[len(scope):].split("/")[0]
        if not spec.startswith("."):
            return None
        resolved = (file.parent / spec).resolve()
    try:
        rel = resolved.resolve().relative_to(pkgs.resolve())
    except ValueError:
        return None
    return rel.parts[0] if rel.parts else None


def check(root: Path, allow: dict[str, list[str]], packages_dir: str = "packages",
          scope: str = "@hydra/") -> list[Violation]:
    root = Path(root)
    pkgs = root / packages_dir
    names = {p.name for p in pkgs.iterdir() if p.is_dir()}
    out: list[Violation] = []
    for pkg in sorted(names):
        allowed = set(allow.get(pkg, []))
        for f in sorted((pkgs / pkg).rglob("*")):
            if f.suffix not in (".py", ".ts") or "node_modules" in f.parts or "tests" in f.parts:
                continue
            for spec in imports_of(f):
                t = _target(root, pkgs, f, spec, scope, names)
                if t is None or t == pkg:
                    continue
                if t not in allowed:
                    out.append(Violation(str(f.relative_to(root)), pkg, t, spec))
    return out


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    rules = json.loads(Path(sys.argv[2]).read_text())
    v = check(Path(sys.argv[1]), rules["allow"], rules.get("packages_dir", "packages"))
    for x in v:
        print(f"  {x.source} -> {x.target}   {x.file}   {x.spec!r}")
    print("layers OK" if not v else f"{len(v)} violation(s)")
    sys.exit(1 if v else 0)
