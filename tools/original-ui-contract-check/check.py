#!/usr/bin/env python3
"""Compare selected original UI contracts with explicitly scoped observations.

No GUI is launched. A matched comparison is never a runtime acceptance claim.
The baseline is read from the existing repository JSON, not copied into this tool.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from typing import Any


PRODUCTS = ("qingsong/main", "minfeiqi/main", "chengben/main")
STATUSES = ("matched", "mismatch", "not-tested", "unknown")


class InputError(ValueError):
    pass


@dataclass(frozen=True)
class Case:
    name: str
    object: str
    entry: str
    controls: tuple[str, ...]
    relations: tuple[tuple[str, str, str], ...] = ()
    menu_groups: tuple[str, ...] = ()
    tables: tuple[str, ...] = ()
    entry_known: bool = True


LOGIN_CONTROLS = (
    "ddlb_1", "sle_id", "sle_password", "em_1", "cb_3", "cb_new",
    "cb_ok", "cb_exit", "st_1", "st_userid", "st_pswd", "st_rq",
)
LOGIN_RELATIONS = (
    ("above", "ddlb_1", "sle_id"), ("above", "sle_id", "sle_password"),
    ("above", "sle_password", "em_1"), ("above", "em_1", "cb_ok"),
    ("column-overlap", "ddlb_1", "sle_id"),
    ("column-overlap", "sle_id", "sle_password"),
    ("column-overlap", "sle_password", "em_1"),
    ("left-of", "ddlb_1", "cb_3"), ("row-overlap", "ddlb_1", "cb_3"),
    ("left-of", "cb_new", "cb_ok"), ("left-of", "cb_ok", "cb_exit"),
    ("row-overlap", "cb_new", "cb_ok"), ("row-overlap", "cb_ok", "cb_exit"),
    ("left-of", "st_1", "ddlb_1"), ("left-of", "st_userid", "sle_id"),
    ("left-of", "st_pswd", "sle_password"), ("left-of", "st_rq", "em_1"),
)
EDITOR_CONTROLS = (
    "uo_1", "em_pzrq", "ddlb_pzlx", "em_pzbh", "em_fds", "dw_master",
    "st_shr_n", "st_jzr_n", "st_zdr_n", "dw_detail", "cb_1", "cb_2",
)
EDITOR_RELATIONS = (
    ("above", "em_pzrq", "ddlb_pzlx"),
    ("left-of", "ddlb_pzlx", "em_pzbh"), ("left-of", "em_pzbh", "em_fds"),
    ("row-overlap", "ddlb_pzlx", "em_pzbh"),
    ("row-overlap", "em_pzbh", "em_fds"),
    ("above", "ddlb_pzlx", "dw_master"), ("above", "dw_master", "st_shr_n"),
    ("left-of", "st_shr_n", "st_jzr_n"), ("left-of", "st_jzr_n", "st_zdr_n"),
    ("above", "st_shr_n", "dw_detail"), ("left-of", "cb_1", "cb_2"),
)
BOOK_BUTTONS = ("cb_1", "cb_6", "cb_3", "cb_2", "cb_4", "cb_5")
CASES = (
    Case("login.startup", "w_login", "event:w_frame.open", LOGIN_CONTROLS, LOGIN_RELATIONS),
    Case("login.switch-book", "w_login", "menu:m_frame_zw/m_system/m_system_trans",
         LOGIN_CONTROLS, LOGIN_RELATIONS),
    Case("login.switch-user", "w_login_1", "menu:m_frame_zw/m_s/m_s30",
         ("sle_id", "sle_password", "cb_ok", "cb_exit", "st_userid", "st_pswd"),
         (("above", "sle_id", "sle_password"), ("above", "sle_password", "cb_ok"),
          ("left-of", "cb_ok", "cb_exit"), ("row-overlap", "cb_ok", "cb_exit"))),
    Case("book.manage", "w_tzjl", "menu:m_frame_zw/m_s/m_s05",
         ("dw_1", *BOOK_BUTTONS, "cb_7"),
         tuple(("above", a, b) for a, b in zip(BOOK_BUTTONS, BOOK_BUTTONS[1:]))
         + tuple(("column-overlap", BOOK_BUTTONS[0], b) for b in BOOK_BUTTONS[1:])
         + (("left-of", "dw_1", "cb_1"), ("above", "dw_1", "cb_7")),
         tables=("dw_1",)),
    Case("book.search", "w_xt_tz_find", "control:w_login/cb_3.clicked",
         ("sle_1", "cb_1", "dw_1", "st_1", "st_3", "st_4"),
         (("left-of", "sle_1", "cb_1"), ("above", "sle_1", "dw_1"),
          ("above", "dw_1", "st_3"), ("above", "st_3", "st_4")), tables=("dw_1",)),
    Case("frame.startup", "w_frame", "application:rh_pos.apl.open", ("mdi_1",),
         menu_groups=("m_system", "m_window", "m_help")),
    Case("voucher.list", "w_pz_pzxsb", "menu:m_frame_zw/m_o/m_o10/m_o10_10",
         ("uo_1", "cb_3", "sle_1", "cb_1", "cbx_1", "cb_2", "dw_master"),
         (("left-of", "cb_3", "sle_1"), ("left-of", "sle_1", "cb_1"),
          ("left-of", "cb_1", "cbx_1"), ("left-of", "cbx_1", "cb_2"),
          ("above", "cb_3", "dw_master"), ("above", "sle_1", "dw_master")),
         menu_groups=("m_operation",), tables=("dw_master",)),
    Case("voucher.browse", "w_pz_see", "menu:m_frame_zw/m_o/m_o10/m_o10_20",
         ("em_1", "em_4", "ddlb_2", "em_2", "em_3", "cb_2", "cb_1"),
         (("left-of", "em_1", "em_4"), ("above", "em_1", "ddlb_2"),
          ("above", "ddlb_2", "em_2"), ("left-of", "em_2", "em_3"),
          ("left-of", "cb_2", "cb_1"))),
    Case("voucher.query", "w_pz_pzxsb_see", "control:w_pz_see/cb_2.clicked",
         ("uo_1", "cb_3", "sle_1", "cb_1", "cbx_1", "cb_2", "dw_master"),
         (("left-of", "cb_3", "sle_1"), ("left-of", "sle_1", "cb_1"),
          ("left-of", "cb_1", "cbx_1"), ("left-of", "cbx_1", "cb_2"),
          ("above", "sle_1", "dw_master")), menu_groups=("m_operation",),
         tables=("dw_master",)),
    Case("voucher.review", "w_pz_tjsh", "menu:m_frame_zw/m_o/m_o10/m_pzsh",
         ("em_1", "em_2", "em_3", "ddlb_1", "em_4", "em_5", "rb_1", "rb_2", "cb_1", "cb_2"),
         (("above", "em_1", "em_2"), ("above", "em_2", "ddlb_1"),
          ("above", "ddlb_1", "em_4"), ("above", "em_4", "rb_1"),
          ("left-of", "rb_1", "rb_2"), ("left-of", "cb_1", "cb_2"))),
    Case("voucher.delete", "w_pz_tjdel", "event:w_pz_pzxsb/ue_action_del",
         ("em_1", "em_2", "em_3", "ddlb_1", "em_4", "em_5", "cb_1", "cb_2"),
         (("above", "em_1", "em_2"), ("above", "em_2", "ddlb_1"),
          ("above", "ddlb_1", "em_4"), ("above", "em_4", "cb_1"),
          ("left-of", "cb_1", "cb_2"))),
    # The logical candidate scenario identifies the observation, not a proven
    # dynamic original caller. The missing original entry evidence stays unknown.
    Case("editor.standard", "w_pz_pzedit", "scenario:voucher-editor/standard",
         EDITOR_CONTROLS, EDITOR_RELATIONS, ("m_operation",),
         ("dw_master", "dw_detail"), entry_known=False),
    Case("editor.large", "w_pz_pzedit_b", "scenario:voucher-editor/large",
         EDITOR_CONTROLS, EDITOR_RELATIONS, ("m_operation",),
         ("dw_master", "dw_detail"), entry_known=False),
)


def normalized_text(value: str) -> str:
    # UIA often removes mnemonic ampersands; spaces are a visual presentation.
    # Keep punctuation, words and mnemonic letters, including their order.
    return re.sub(r"\s+", "", value.replace("&", ""))


def normalized_shortcut(value: str) -> str:
    aliases = {"control": "ctrl", "del": "delete", "return": "enter"}
    parts = [aliases.get(p.strip().lower(), p.strip().lower()) for p in value.split("+")]
    return "+".join(sorted(parts))


def unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """Reject duplicate keys at every JSON object depth before values are lost."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise InputError(f"Duplicate JSON key: {key!r}")
        result[key] = value
    return result


def load_json(path: Path) -> dict[str, Any]:
    try:
        if path.stat().st_size > 16 * 1024 * 1024:
            raise InputError(f"JSON exceeds 16 MiB: {path}")
        data = json.loads(path.read_text(encoding="utf-8"),
                          object_pairs_hook=unique_json_object,
                          parse_constant=lambda x: (_ for _ in ()).throw(InputError(f"Invalid JSON number: {x}")))
    except (OSError, UnicodeError, json.JSONDecodeError, InputError) as exc:
        raise InputError(f"Cannot read JSON {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise InputError(f"Expected a JSON object: {path}")
    return data


def walk_controls(items: list[dict[str, Any]], prefix: str = "") -> dict[str, dict[str, Any]]:
    result = {}
    for item in items:
        name = prefix + item["name"]
        result[name] = item
        result.update(walk_controls(item.get("children", []), name + "/"))
    return result


def walk_menus(items: list[dict[str, Any]], prefix: tuple[str, ...] = ()):
    for item in items:
        path = prefix + (item["name"],)
        yield path, item
        yield from walk_menus(item.get("children", []), path)


def validate_observations(data: dict[str, Any]) -> dict[tuple[str, str, str], dict[str, Any]]:
    if type(data.get("schema_version")) is not int or data["schema_version"] != 1:
        raise InputError("observations.schema_version must be 1")
    provenance = data.get("provenance", {})
    if not isinstance(provenance, dict) or provenance.get("kind", "unspecified") not in (
        "synthetic", "static", "uia", "unspecified"
    ):
        raise InputError("provenance.kind must be synthetic, static, uia or unspecified")
    windows = data.get("windows", [])
    if not isinstance(windows, list) or len(windows) > 100:
        raise InputError("windows must be an array with at most 100 entries")
    result = {}
    for window in windows:
        if not isinstance(window, dict):
            raise InputError("each observed window must be an object")
        identity = tuple(window.get(k) for k in ("product", "object", "entry"))
        if not all(isinstance(x, str) and x for x in identity):
            raise InputError("each window requires nonempty product, object and entry strings")
        if identity[0] not in PRODUCTS:
            raise InputError(f"unsupported product: {identity[0]}")
        if identity in result:
            raise InputError(f"duplicate window identity: {identity}")
        coverage = window.get("coverage", {})
        if not isinstance(coverage, dict) or any(
            v not in ("partial", "complete") for v in coverage.values()
        ) or any(k not in ("controls", "menus", "columns") for k in coverage):
            raise InputError("coverage supports controls/menus/columns: partial or complete")
        controls = window.get("controls", [])
        if not isinstance(controls, list) or len(controls) > 2048:
            raise InputError("controls must be an array with at most 2048 entries")
        ids = set()
        for control in controls:
            if not isinstance(control, dict) or not isinstance(control.get("id"), str) or not control["id"]:
                raise InputError("each observed control requires a nonempty mapped id")
            if control["id"] in ids:
                raise InputError(f"duplicate control id: {control['id']}")
            ids.add(control["id"])
            validate_observed_item(control)
            if "bounds" in control:
                bounds = control["bounds"]
                if not isinstance(bounds, dict) or not all(
                    isinstance(bounds.get(k), (int, float)) and not isinstance(bounds.get(k), bool)
                    and math.isfinite(bounds[k]) for k in ("x", "y", "width", "height")
                ) or bounds["width"] <= 0 or bounds["height"] <= 0:
                    raise InputError(f"invalid finite bounds for control {control['id']}")
                if bounds.get("unit") not in ("pixels", "dip", "abstract") or not isinstance(
                    bounds.get("space"), str
                ) or not bounds["space"]:
                    raise InputError("bounds require unit pixels/dip/abstract and nonempty coordinate space")
                if bounds["unit"] == "abstract" and provenance.get("kind") == "uia":
                    raise InputError("UIA observations cannot use synthetic abstract coordinates")
        menus = window.get("menus", [])
        validate_menu_tree(menus)
        tables = window.get("tables", [])
        if not isinstance(tables, list):
            raise InputError("tables must be an array")
        table_ids = set()
        for table in tables:
            if not isinstance(table, dict) or not isinstance(table.get("control"), str):
                raise InputError("table observations require a mapped control string")
            if table["control"] in table_ids:
                raise InputError("duplicate table observation")
            table_ids.add(table["control"])
            columns = table.get("columns")
            if not isinstance(columns, list) or not all(isinstance(x, str) and x for x in columns):
                raise InputError("table.columns must be an ordered array of mapped column ids")
            if len(columns) != len(set(columns)):
                raise InputError("duplicate observed column id")
        result[identity] = window
    return result


def validate_observed_item(item: dict[str, Any]) -> None:
    for key in ("text", "shortcut", "automation_id"):
        if key in item and not isinstance(item[key], str):
            raise InputError(f"observed {key} must be a string; omit unknown values")
    for key in ("visible", "enabled"):
        if key in item and not isinstance(item[key], bool):
            raise InputError(f"observed {key} must be boolean; omit unknown values")


def validate_menu_tree(items: Any, depth: int = 0) -> None:
    if not isinstance(items, list) or len(items) > 512 or depth > 10:
        raise InputError("invalid or excessively deep menu tree")
    ids = set()
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
            raise InputError("each menu requires a nonempty mapped id")
        if item["id"] in ids:
            raise InputError(f"duplicate sibling menu id: {item['id']}")
        ids.add(item["id"])
        validate_observed_item(item)
        validate_menu_tree(item.get("children", []), depth + 1)


def source_record(file: str, product: str, obj: str, **fields: Any) -> dict[str, Any]:
    return {"file": f"docs/original-analysis/json/{file}.json", "product": product,
            "object": obj, **fields}


class Comparison:
    def __init__(self, product: str, case: Case, observed: dict[str, Any] | None):
        self.product, self.case, self.observed = product, case, observed
        self.checks: list[dict[str, Any]] = []

    def add(self, id: str, kind: str, status: str, *, expected: Any = None,
            observed: Any = None, reason: str = "", source: dict[str, Any] | None = None):
        if status not in STATUSES:
            raise ValueError(status)
        item = {"id": id, "kind": kind, "status": status}
        if expected is not None:
            item["expected"] = expected
        if observed is not None:
            item["observed"] = observed
        if reason:
            item["reason"] = reason
        if source:
            item["source"] = source
        self.checks.append(item)

    def absent(self, kind: str) -> str:
        return "mismatch" if self.observed and self.observed.get("coverage", {}).get(kind) == "complete" else "not-tested"

    def scalar(self, id: str, kind: str, expected: str, item: dict[str, Any] | None,
               field: str, source: dict[str, Any], *, coverage: str):
        if item is None:
            self.add(id, kind, self.absent(coverage), expected=expected,
                     reason="absent from complete enumeration" if self.absent(coverage) == "mismatch"
                     else "observation not supplied or enumeration is partial", source=source)
        elif field not in item:
            self.add(id, kind, "not-tested", expected=expected,
                     reason=f"probe did not supply {field}", source=source)
        else:
            normalize = normalized_shortcut if kind == "shortcut" else normalized_text
            self.add(id, kind, "matched" if normalize(expected) == normalize(item[field]) else "mismatch",
                     expected=expected, observed=item[field], source=source)


def relation_holds(kind: str, a: dict[str, Any], b: dict[str, Any]) -> bool:
    if kind == "left-of":
        return a["x"] < b["x"]
    if kind == "above":
        return a["y"] < b["y"]
    if kind == "row-overlap":
        return max(a["y"], b["y"]) < min(a["y"] + a["height"], b["y"] + b["height"])
    if kind == "column-overlap":
        return max(a["x"], b["x"]) < min(a["x"] + a["width"], b["x"] + b["width"])
    raise InputError(f"unsupported relation: {kind}")


def compare_window(product: str, case: Case, observed: dict[str, Any] | None,
                   windows: dict[str, Any], menus: dict[str, Any], datawindows: dict[str, Any]):
    try:
        original = windows[product][case.object]
        source_controls = walk_controls(original["controls"])
        for id in case.controls:
            if id not in source_controls:
                raise InputError(f"baseline drift: {product}/{case.object} has no {id}")
    except KeyError as exc:
        raise InputError(f"baseline object unavailable: {product}/{case.object}") from exc
    result = Comparison(product, case, observed)
    base = source_record("windows", product, case.object)
    result.add("window.presence", "window", "matched" if observed else "not-tested",
               expected={"product": product, "object": case.object, "entry": case.entry},
               reason="exact three-part identity only; a different entry cannot satisfy this case", source=base)
    if not case.entry_known:
        result.add("entry.original-runtime-caller", "entry", "unknown",
                   reason="logical candidate scenario; original dynamic editor selection is not captured", source=base)
    controls = {x["id"]: x for x in observed.get("controls", [])} if observed else {}
    for id in case.controls:
        src = source_record("windows", product, case.object, control=id, field="props")
        props = source_controls[id]["props"]
        actual = controls.get(id)
        result.add(f"control.{id}.presence", "control", "matched" if actual is not None else result.absent("controls"),
                   expected=id, reason="mapped identity; no inference from similar captions", source=src)
        if props.get("text") and props["text"] != "none":
            result.scalar(f"control.{id}.text", "text", props["text"], actual, "text", src, coverage="controls")
        result.add(f"control.{id}.visibility", "visibility", "unknown",
                   expected={"design_visible": props.get("visible", "not-exported")},
                   observed=actual.get("visible") if actual else None,
                   reason="design property is not original visibility for this runtime/permission state", source=src)
    for kind, first, second in case.relations:
        # Verify each curated relation against the actual selected product's PBU
        # properties. Never introduce a pixel/PBU multiplier.
        p = source_controls[first]["props"]
        q = source_controls[second]["props"]
        required = ("x", "y", "width", "height") if kind.endswith("overlap") else (("x",) if kind == "left-of" else ("y",))
        source_ok = all(k in props for props in (p, q) for k in required)
        if not source_ok:
            result.add(f"position.{kind}.{first}.{second}", "position", "unknown",
                       reason="original coordinate property not exported", source=base)
            continue
        a0, b0 = ({k: float(v) for k, v in item.items() if k in ("x", "y", "width", "height")}
                  for item in (p, q))
        if not relation_holds(kind, a0, b0):
            raise InputError(f"baseline drift: relation {case.name}/{kind}/{first}/{second} is no longer supported")
        a, b = controls.get(first), controls.get(second)
        expectation = {"relation": kind, "first": first, "second": second}
        if not a or not b or not a.get("bounds") or not b.get("bounds") or a.get("visible") is not True or b.get("visible") is not True:
            result.add(f"position.{kind}.{first}.{second}", "position", "not-tested", expected=expectation,
                       reason="requires both observed, visible controls and their bounds", source=base)
        elif (a["bounds"]["space"], a["bounds"]["unit"]) != (b["bounds"]["space"], b["bounds"]["unit"]):
            result.add(f"position.{kind}.{first}.{second}", "position", "not-tested", expected=expectation,
                       reason="coordinates are in different spaces or units; no conversion guessed", source=base)
        else:
            result.add(f"position.{kind}.{first}.{second}", "position",
                       "matched" if relation_holds(kind, a["bounds"], b["bounds"]) else "mismatch",
                       expected=expectation, observed={first: a["bounds"], second: b["bounds"]}, source=base)
    menu_name = original["props"].get("menuname")
    if menu_name:
        compare_menus(result, menus[product][menu_name]["items"], menu_name, case.menu_groups)
        result.add("toolbar.visual-order", "toolbar-order", "unknown",
                   reason="menu order and toolbar labels do not establish runtime toolbar order", source=base)
    for table_control in case.tables:
        dwo = source_controls[table_control]["props"].get("dataobject")
        key = product.split("/", 1)[0] + "/" + str(dwo)
        if key not in datawindows:
            raise InputError(f"baseline datawindow unavailable: {key}")
        actual = next((x for x in observed.get("tables", []) if x["control"] == table_control), None) if observed else None
        result.add(f"columns.{table_control}.order", "column-order", "unknown",
                   observed=actual["columns"] if actual else None,
                   reason="source column array is a data schema, not proven visible screen order",
                   source=source_record("datawindows", product, dwo, control=table_control))
        if actual is None:
            result.add(f"columns.{table_control}.observation", "columns", "not-tested",
                       reason="no table column observation supplied; original order remains unknown", source=base)
    if case.object in ("w_login", "w_login_1", "w_pz_pzedit", "w_pz_pzedit_b"):
        result.add("keyboard.default-tab-and-close-flow", "runtime-behavior", "unknown",
                   reason="default/cancel keys, full focus route and save/close control flow are not fully exported", source=base)
    counts = Counter(x["status"] for x in result.checks)
    return {"product": product, "object": case.object, "entry": case.entry, "case": case.name,
            "counts": {k: counts[k] for k in STATUSES}, "checks": result.checks}


def compare_menus(result: Comparison, original: list[dict[str, Any]], name: str, groups: tuple[str, ...]):
    observed = result.observed.get("menus", []) if result.observed else []
    src = source_record("menus", result.product, name)

    def level(expected: list[dict[str, Any]], actual: list[dict[str, Any]], path: tuple[str, ...], recurse: bool):
        # Hidden items retain unknown runtime visibility and are optional here.
        # Visible design items are the selected structural baseline, not an
        # assertion that a restricted user's UIA snapshot must enumerate them.
        required = [x for x in expected if x.get("text") != "-" and x.get("visible", True)]
        actual_by_id = {x["id"]: x for x in actual}
        expected_ids = [x["name"] for x in required]
        seen_ids = [x["id"] for x in actual if x["id"] in expected_ids]
        present_ids = [id for id in expected_ids if id in actual_by_id]
        order_status = "matched" if len(seen_ids) >= 2 and seen_ids == present_ids else (
            "mismatch" if len(seen_ids) >= 2 else "not-tested")
        result.add("menu." + "/".join(path or ("menubar",)) + ".order", "menu-order", order_status,
                   expected=present_ids, observed=seen_ids,
                   reason="relative order of observed baseline items; absent items checked separately", source=src)
        for item in expected:
            if item.get("text") == "-":
                continue
            target = actual_by_id.get(item["name"])
            current = path + (item["name"],)
            label = "menu." + "/".join(current)
            item_src = {**src, "item_path": list(current)}
            result.add(label + ".visibility", "visibility", "unknown",
                       expected={"design_visible": item.get("visible", True)},
                       observed=target.get("visible") if target else None,
                       reason="runtime version/permission scripts may change visibility", source=item_src)
            if item.get("visible", True):
                result.scalar(label + ".text", "text", item["text"], target, "text", item_src, coverage="menus")
                if item.get("shortcut"):
                    result.scalar(label + ".shortcut", "shortcut", item["shortcut"], target,
                                  "shortcut", item_src, coverage="menus")
            if item.get("children") and (recurse or item["name"] in groups):
                level(item["children"], target.get("children", []) if target else [], current, True)

    level(original, observed, (), False)


def evaluate(repo: Path, data: dict[str, Any], products: tuple[str, ...] = PRODUCTS,
             selected_cases: tuple[str, ...] = ()) -> dict[str, Any]:
    if not products or any(p not in PRODUCTS for p in products):
        raise InputError("select at least one supported product")
    if any(c not in {x.name for x in CASES} for c in selected_cases):
        raise InputError("unsupported case name")
    observations = validate_observations(data)
    directory = repo / "docs/original-analysis/json"
    baseline = {k: load_json(directory / f"{k}.json") for k in ("windows", "menus", "datawindows")}
    cases = [c for c in CASES if not selected_cases or c.name in selected_cases]
    reports = []
    identities = set()
    for product in dict.fromkeys(products):
        for case in cases:
            identity = (product, case.object, case.entry)
            identities.add(identity)
            reports.append(compare_window(product, case, observations.get(identity), **baseline))
    unmatched = []
    out_of_scope = []
    all_known = {(p, c.object, c.entry) for p in PRODUCTS for c in CASES}
    for identity in observations:
        if identity not in all_known:
            unmatched.append({"product": identity[0], "object": identity[1], "entry": identity[2],
                              "status": "mismatch", "reason": "unregistered product/object/entry identity"})
        elif identity not in identities:
            out_of_scope.append({"product": identity[0], "object": identity[1], "entry": identity[2]})
    grouped: dict[str, list[dict[str, Any]]] = {k: [] for k in STATUSES}
    for report in reports:
        identity = {k: report[k] for k in ("product", "object", "entry", "case")}
        for check in report["checks"]:
            grouped[check["status"]].append({**identity, **check})
    grouped["mismatch"].extend(unmatched)
    counts = {k: len(v) for k, v in grouped.items()}
    provenance = data.get("provenance", {"kind": "unspecified"})
    comparison = "mismatch" if counts["mismatch"] else ("incomplete" if counts["not-tested"] else "matched")
    # Provenance is caller-supplied, not authenticated by this offline comparator.
    # Even a file declaring "uia" cannot establish that an original session ran.
    runtime = "not-tested" if provenance.get("kind", "unspecified") != "uia" else "not-established"
    return {
        "schema_version": 1,
        "baseline": {"files": {f"docs/original-analysis/json/{k}.json": hashlib.sha256(
            (directory / f"{k}.json").read_bytes()).hexdigest() for k in baseline},
                     "basis": "existing static analysis; no original runtime capture"},
        "observation_provenance": provenance,
        "comparison": comparison,
        "runtime_acceptance": runtime,
        "runtime_note": "This tool compares claims; it does not authenticate UIA captures or certify real-program acceptance.",
        "exit_code": 1 if counts["mismatch"] else 3,
        "counts": counts,
        "mismatches": grouped["mismatch"],
        "not_tested": grouped["not-tested"],
        "unknowns": grouped["unknown"],
        "out_of_scope_observations": out_of_scope,
        "cases": reports,
    }


def describe() -> dict[str, Any]:
    return {"schema_version": 1, "products": list(PRODUCTS), "cases": [
        {"case": c.name, "object": c.object, "entry": c.entry,
         "entry_evidence": "static" if c.entry_known else "unknown-dynamic-caller"}
        for c in CASES], "note": "Identifiers and scope only; not a full original JSON export."}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--observations", type=Path)
    parser.add_argument("--product", action="append", choices=PRODUCTS)
    parser.add_argument("--case", action="append", choices=[c.name for c in CASES])
    parser.add_argument("--output", type=Path, help="JSON report path; omit to print JSON")
    parser.add_argument("--list-cases", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.list_cases:
            print(json.dumps(describe(), ensure_ascii=False, indent=2))
            return 0  # This is an inventory command, never an acceptance verdict.
        data = load_json(args.observations) if args.observations else {
            "schema_version": 1, "provenance": {"kind": "unspecified"}, "windows": []}
        result = evaluate(args.repo, data, tuple(args.product or PRODUCTS), tuple(args.case or ()))
        rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.write_text(rendered, encoding="utf-8")
            print(f"comparison={result['comparison']} runtime_acceptance={result['runtime_acceptance']} "
                  + " ".join(f"{k}={v}" for k, v in result["counts"].items()))
            print(f"report={args.output}")
        else:
            print(rendered, end="")
        return result["exit_code"]
    except (InputError, OSError) as exc:
        print(f"input-error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
