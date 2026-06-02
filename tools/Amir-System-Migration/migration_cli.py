#!/usr/bin/env python3
"""Job-based CLI for trusted, repeatable Access migration discovery.

This CLI is read-only against the Access database.
It runs predefined discovery jobs and writes JSON reports to disk.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from inspect_access_mdb import fetch_columns, fetch_count, fetch_rows, list_objects, open_connection, quote_access_name


TOOL_VERSION = "1.1.0"

LESSON_CANDIDATES = [
    "qryRiderLessonsDiary",
    "qryRidersLessonsDiary",
    "qryRiderLessons",
    "qryLessonsList",
    "qryMasterLessons",
    "Attendance",
    "OrgRidersDiary",
    "NotRecordedLessons",
    "LessonsChngExeDetails",
    "LessonSections",
    "Commitments",
    "qryOrgLessons",
]

RIDER_CANDIDATES = [
    "Riders",
    "RiderParents",
    "RidersHorsesConn",
    "OrgRiders",
    "OrgRidersDiary",
    "RiderDirection",
    "RiderAllergies",
]


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_output_dir(output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def sanitize_filename(value: str) -> str:
    safe = []
    for ch in value:
        if ch.isalnum() or ch in ("-", "_"):
            safe.append(ch)
        else:
            safe.append("_")
    return "".join(safe).strip("_") or "job"


def write_report(output_dir: Path, job_name: str, payload: dict) -> Path:
    ensure_output_dir(output_dir)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    file_name = f"{ts}_{sanitize_filename(job_name)}.json"
    path = output_dir / file_name

    data = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
    checksum = hashlib.sha256(data.encode("utf-8")).hexdigest()
    payload["report_sha256"] = checksum

    final_data = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
    path.write_text(final_data, encoding="utf-8")
    return path


def build_base_report(mdb_path: Path | None, provider: str | None, job: str, result: dict, status: str) -> dict:
    return {
        "tool": "migration-cli",
        "tool_version": TOOL_VERSION,
        "timestamp_utc": iso_now(),
        "mdb_path": str(mdb_path) if mdb_path else None,
        "provider": provider,
        "job": job,
        "status": status,
        "read_only": True,
        "result": result,
    }


def resolve_password(password: str | None, password_env: str | None, prompt_if_missing: bool) -> str | None:
    if password:
        return password
    if password_env and os.getenv(password_env):
        return os.getenv(password_env)
    if prompt_if_missing:
        entered = getpass.getpass("MDB password (leave empty if none): ")
        return entered or None
    return None


def object_exists(conn, object_name: str, include_system: bool = True) -> bool:
    objects = list_objects(conn, include_system=include_system)
    names = {str(row.get("TABLE_NAME")) for row in objects}
    return object_name in names


def safe_count(conn, object_name: str) -> dict:
    try:
        return {"object_name": object_name, "total_rows": fetch_count(conn, object_name), "ok": True}
    except Exception as exc:  # pragma: no cover - depends on local data/content
        return {"object_name": object_name, "ok": False, "error": str(exc)}


def safe_columns(conn, object_name: str) -> dict:
    try:
        columns = fetch_columns(conn, object_name)
        if columns:
            return {"object_name": object_name, "columns": columns, "ok": True, "method": "top0"}

        # Fallback: some Access objects/providers return empty field metadata for TOP 0.
        # Try TOP 1 field metadata and capture names only.
        sql = f"SELECT TOP 1 * FROM {quote_access_name(object_name)}"
        recordset = conn.Execute(sql)[0]
        fallback_cols = []
        for field in recordset.Fields:
            fallback_cols.append(
                {
                    "name": field.Name,
                    "type": field.Type,
                    "defined_size": getattr(field, "DefinedSize", None),
                    "precision": getattr(field, "Precision", None),
                    "numeric_scale": getattr(field, "NumericScale", None),
                    "attributes": getattr(field, "Attributes", None),
                }
            )
        return {"object_name": object_name, "columns": fallback_cols, "ok": True, "method": "top1-fallback"}
    except Exception as exc:  # pragma: no cover
        return {"object_name": object_name, "ok": False, "error": str(exc)}


def safe_sample(conn, object_name: str, rows: int) -> dict:
    try:
        return {"object_name": object_name, "rows": fetch_rows(conn, object_name, rows), "ok": True}
    except Exception as exc:  # pragma: no cover
        return {"object_name": object_name, "ok": False, "error": str(exc)}


def compute_rider_parent_duplicates(conn, max_rows: int = 20000) -> dict:
    payload = safe_sample(conn, "RiderParents", max_rows)
    if not payload.get("ok"):
        return payload

    rows = payload.get("rows", [])
    groups: dict[str, list[dict]] = {}
    for row in rows:
        rider_id = str(row.get("RiderId"))
        groups.setdefault(rider_id, []).append(row)

    duplicates = {rider_id: items for rider_id, items in groups.items() if len(items) > 1}
    return {
        "ok": True,
        "scanned_rows": len(rows),
        "duplicate_rider_id_count": len(duplicates),
        "duplicates": duplicates,
    }


def run_inventory_job(conn) -> dict:
    objects = list_objects(conn, include_system=False)
    grouped = {}
    for obj in objects:
        obj_type = str(obj.get("TABLE_TYPE") or "UNKNOWN")
        grouped.setdefault(obj_type, []).append(
            {
                "name": obj.get("TABLE_NAME"),
                "created": obj.get("DATE_CREATED"),
                "modified": obj.get("DATE_MODIFIED"),
            }
        )
    for key in grouped:
        grouped[key] = sorted(grouped[key], key=lambda x: str(x.get("name") or ""))
    return {"job": "inventory", "groups": grouped}


def run_riders_core_job(conn, sample_rows: int) -> dict:
    report = {
        "job": "riders-core",
        "tables": {},
        "duplicates": compute_rider_parent_duplicates(conn),
    }

    for name in ["Riders", "RiderParents"]:
        report["tables"][name] = {
            "count": safe_count(conn, name),
            "columns": safe_columns(conn, name),
            "sample": safe_sample(conn, name, sample_rows),
        }
    return report


def run_lessons_candidates_job(conn, sample_rows: int, candidates: list[str]) -> dict:
    report = {
        "job": "lessons-candidates",
        "candidates": [],
    }
    for name in candidates:
        exists = object_exists(conn, name, include_system=False)
        item = {
            "object_name": name,
            "exists": exists,
        }
        if exists:
            item["count"] = safe_count(conn, name)
            item["columns"] = safe_columns(conn, name)
            item["sample"] = safe_sample(conn, name, sample_rows)
        report["candidates"].append(item)

    # Auto-recommend the most useful lesson source based on known priority + row count.
    preferred_order = [
        "qryRiderLessonsDiary",
        "qryRidersLessonsDiary",
        "qryRiderLessons",
        "qryLessonsList",
        "qryMasterLessons",
    ]
    by_name = {
        str(item.get("object_name")): item
        for item in report["candidates"]
        if isinstance(item, dict)
    }

    recommendation = None
    for source_name in preferred_order:
        source = by_name.get(source_name)
        if not source or not source.get("exists"):
            continue
        count_payload = source.get("count") if isinstance(source.get("count"), dict) else {}
        row_count = count_payload.get("total_rows") if isinstance(count_payload, dict) else None
        try:
            row_count_num = int(row_count)
        except Exception:
            row_count_num = 0
        if row_count_num > 0:
            recommendation = {
                "object_name": source_name,
                "reason": "preferred_named_query_with_rows",
                "row_count": row_count_num,
            }
            break

    if recommendation is None:
        # Fallback to largest existing candidate.
        best_name = None
        best_rows = -1
        for item in report["candidates"]:
            if not isinstance(item, dict) or not item.get("exists"):
                continue
            count_payload = item.get("count") if isinstance(item.get("count"), dict) else {}
            row_count = count_payload.get("total_rows") if isinstance(count_payload, dict) else None
            try:
                row_count_num = int(row_count)
            except Exception:
                row_count_num = 0
            if row_count_num > best_rows:
                best_rows = row_count_num
                best_name = str(item.get("object_name"))
        if best_name:
            recommendation = {
                "object_name": best_name,
                "reason": "largest_existing_candidate",
                "row_count": best_rows,
            }

    report["recommended_lesson_source"] = recommendation
    return report


def run_all_discovery_job(conn, sample_rows: int) -> dict:
    return {
        "job": "all",
        "inventory": run_inventory_job(conn),
        "riders_core": run_riders_core_job(conn, sample_rows),
        "lessons_candidates": run_lessons_candidates_job(conn, sample_rows, LESSON_CANDIDATES),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Read-only job CLI for Access .mdb migration discovery")
    sub = parser.add_subparsers(dest="command", required=False)

    run = sub.add_parser("run", help="Run a predefined discovery job")
    run.add_argument("job", choices=["inventory", "riders-core", "lessons-candidates", "all"]) 
    run.add_argument("--mdb", required=True, help="Path to .mdb file")
    run.add_argument("--password", help="MDB password")
    run.add_argument("--password-env", default="MDB_PASSWORD", help="Environment variable for MDB password")
    run.add_argument("--sample-rows", type=int, default=10, help="Rows to sample per object")
    run.add_argument("--output-dir", default="tools/Amir-System-Migration/output", help="Where JSON reports are written")
    run.add_argument(
        "--lesson-candidates",
        help="Comma separated override for lessons-candidates job",
    )

    wizard = sub.add_parser("wizard", help="Interactive prompt to run a job")
    wizard.add_argument("--mdb", help="Path to .mdb file")
    wizard.add_argument("--password", help="MDB password")
    wizard.add_argument("--password-env", default="MDB_PASSWORD", help="Environment variable for MDB password")
    wizard.add_argument("--sample-rows", type=int, default=10, help="Rows to sample per object")
    wizard.add_argument("--output-dir", default="tools/Amir-System-Migration/output", help="Where JSON reports are written")

    summarize = sub.add_parser("summarize-report", help="Summarize an existing JSON report without exposing row values")
    summarize.add_argument("--report", required=True, help="Path to a report JSON file generated by this tool")
    summarize.add_argument("--output", help="Optional path to write summary JSON")

    parser.set_defaults(command="wizard")
    return parser


def pick_job_interactively() -> str:
    options = [
        ("1", "inventory"),
        ("2", "riders-core"),
        ("3", "lessons-candidates"),
        ("4", "all"),
    ]
    print("Select job:")
    print("  1) inventory")
    print("  2) riders-core")
    print("  3) lessons-candidates")
    print("  4) all")
    while True:
        choice = input("Enter 1-4 [4]: ").strip() or "4"
        for key, value in options:
            if choice == key:
                return value
        print("Invalid choice, try again.")


def run_selected_job(conn, job: str, sample_rows: int, lesson_candidates_arg: str | None) -> dict:
    if job == "inventory":
        return run_inventory_job(conn)
    if job == "riders-core":
        return run_riders_core_job(conn, sample_rows)
    if job == "lessons-candidates":
        if lesson_candidates_arg:
            candidates = [x.strip() for x in lesson_candidates_arg.split(",") if x.strip()]
        else:
            candidates = LESSON_CANDIDATES
        return run_lessons_candidates_job(conn, sample_rows, candidates)
    if job == "all":
        return run_all_discovery_job(conn, sample_rows)
    raise ValueError(f"Unsupported job: {job}")


def run_noninteractive(args) -> int:
    mdb_path = Path(args.mdb).expanduser()
    password = resolve_password(args.password, args.password_env, prompt_if_missing=True)
    provider = None
    conn = None
    try:
        conn, provider = open_connection(mdb_path, password)
        result = run_selected_job(conn, args.job, args.sample_rows, args.lesson_candidates)
        report = build_base_report(mdb_path, provider, args.job, result, status="success")
        out = write_report(Path(args.output_dir), args.job, report)
        print(f"Job completed: {args.job}")
        print(f"Report: {out}")
        return 0
    except Exception as exc:
        error_result = {
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        report = build_base_report(mdb_path, provider, args.job, error_result, status="failed")
        out = write_report(Path(args.output_dir), f"{args.job}-failed", report)
        print(f"Job failed: {args.job}")
        print(f"Failure report: {out}")
        return 1
    finally:
        try:
            if conn is not None:
                conn.Close()
        except Exception:
            pass


def run_wizard(args) -> int:
    mdb_path_text = args.mdb or input("MDB path: ").strip()
    if not mdb_path_text:
        print("MDB path is required.")
        return 2

    job = pick_job_interactively()
    mdb_path = Path(mdb_path_text).expanduser()
    password = resolve_password(args.password, args.password_env, prompt_if_missing=True)
    provider = None
    conn = None
    try:
        conn, provider = open_connection(mdb_path, password)
        result = run_selected_job(conn, job, args.sample_rows, lesson_candidates_arg=None)
        report = build_base_report(mdb_path, provider, job, result, status="success")
        out = write_report(Path(args.output_dir), job, report)
        print(f"Job completed: {job}")
        print(f"Report: {out}")
        return 0
    except Exception as exc:
        error_result = {
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        report = build_base_report(mdb_path, provider, job, error_result, status="failed")
        out = write_report(Path(args.output_dir), f"{job}-failed", report)
        print(f"Job failed: {job}")
        print(f"Failure report: {out}")
        return 1
    finally:
        try:
            if conn is not None:
                conn.Close()
        except Exception:
            pass


def extract_columns(section: dict) -> list[str]:
    columns_payload = ((section or {}).get("columns") or {})
    cols = columns_payload.get("columns") if isinstance(columns_payload, dict) else None
    if not isinstance(cols, list):
        return []
    return [str(col.get("name")) for col in cols if isinstance(col, dict) and col.get("name")]


def extract_columns_error(section: dict) -> str | None:
    columns_payload = ((section or {}).get("columns") or {})
    if isinstance(columns_payload, dict) and columns_payload.get("ok") is False:
        return str(columns_payload.get("error") or "unknown_column_error")
    return None


def extract_count(section: dict) -> int | None:
    count_payload = ((section or {}).get("count") or {})
    if not isinstance(count_payload, dict):
        return None
    if not count_payload.get("ok"):
        return None
    value = count_payload.get("total_rows")
    try:
        return int(value)
    except Exception:
        return None


def summarize_report_payload(payload: dict) -> dict:
    result = payload.get("result") if isinstance(payload, dict) else {}
    summary = {
        "tool": payload.get("tool"),
        "tool_version": payload.get("tool_version"),
        "timestamp_utc": payload.get("timestamp_utc"),
        "job": payload.get("job"),
        "provider": payload.get("provider"),
    }

    if not isinstance(result, dict):
        summary["notes"] = ["No result payload found"]
        return summary

    if payload.get("job") == "inventory":
        groups = result.get("groups") if isinstance(result.get("groups"), dict) else {}
        summary["inventory_counts_by_type"] = {k: len(v) for k, v in groups.items() if isinstance(v, list)}
        summary["high_signal_names"] = {
            "rider_like": [
                x.get("name")
                for x in groups.get("TABLE", [])
                if isinstance(x, dict) and isinstance(x.get("name"), str) and "Rider" in x.get("name")
            ],
            "lesson_like": [
                x.get("name")
                for x in groups.get("TABLE", [])
                if isinstance(x, dict)
                and isinstance(x.get("name"), str)
                and ("Lesson" in x.get("name") or "Diary" in x.get("name") or "Attendance" in x.get("name"))
            ],
        }
        return summary

    if payload.get("job") == "riders-core":
        tables = result.get("tables") if isinstance(result.get("tables"), dict) else {}
        riders = tables.get("Riders") if isinstance(tables.get("Riders"), dict) else {}
        parents = tables.get("RiderParents") if isinstance(tables.get("RiderParents"), dict) else {}
        dup = result.get("duplicates") if isinstance(result.get("duplicates"), dict) else {}

        summary["riders_core"] = {
            "Riders_count": extract_count(riders),
            "RiderParents_count": extract_count(parents),
            "Riders_columns": extract_columns(riders),
            "RiderParents_columns": extract_columns(parents),
            "Riders_columns_error": extract_columns_error(riders),
            "RiderParents_columns_error": extract_columns_error(parents),
            "duplicate_rider_id_count": dup.get("duplicate_rider_id_count"),
            "scanned_parent_rows": dup.get("scanned_rows"),
        }
        return summary

    if payload.get("job") == "lessons-candidates":
        candidates = result.get("candidates") if isinstance(result.get("candidates"), list) else []
        compact = []
        for item in candidates:
            if not isinstance(item, dict):
                continue
            compact.append(
                {
                    "object_name": item.get("object_name"),
                    "exists": item.get("exists"),
                    "row_count": (item.get("count") or {}).get("total_rows") if isinstance(item.get("count"), dict) else None,
                    "column_names": [
                        col.get("name")
                        for col in ((item.get("columns") or {}).get("columns") or [])
                        if isinstance(col, dict) and col.get("name")
                    ],
                    "columns_error": (item.get("columns") or {}).get("error") if isinstance(item.get("columns"), dict) else None,
                }
            )
        summary["lessons_candidates"] = compact
        summary["recommended_lesson_source"] = result.get("recommended_lesson_source")
        return summary

    if payload.get("job") == "all":
        inventory = result.get("inventory") if isinstance(result.get("inventory"), dict) else {}
        riders_core = result.get("riders_core") if isinstance(result.get("riders_core"), dict) else {}
        lessons_candidates = result.get("lessons_candidates") if isinstance(result.get("lessons_candidates"), dict) else {}

        all_summary = {}

        inv_groups = inventory.get("groups") if isinstance(inventory.get("groups"), dict) else {}
        if inv_groups:
            all_summary["inventory_counts_by_type"] = {k: len(v) for k, v in inv_groups.items() if isinstance(v, list)}

        rc_tables = riders_core.get("tables") if isinstance(riders_core.get("tables"), dict) else {}
        rc_riders = rc_tables.get("Riders") if isinstance(rc_tables.get("Riders"), dict) else {}
        rc_parents = rc_tables.get("RiderParents") if isinstance(rc_tables.get("RiderParents"), dict) else {}
        rc_dup = riders_core.get("duplicates") if isinstance(riders_core.get("duplicates"), dict) else {}
        if rc_tables or rc_dup:
            all_summary["riders_core"] = {
                "Riders_count": extract_count(rc_riders),
                "RiderParents_count": extract_count(rc_parents),
                "Riders_columns": extract_columns(rc_riders),
                "RiderParents_columns": extract_columns(rc_parents),
                "Riders_columns_error": extract_columns_error(rc_riders),
                "RiderParents_columns_error": extract_columns_error(rc_parents),
                "duplicate_rider_id_count": rc_dup.get("duplicate_rider_id_count"),
                "scanned_parent_rows": rc_dup.get("scanned_rows"),
            }

        lc_items = lessons_candidates.get("candidates") if isinstance(lessons_candidates.get("candidates"), list) else []
        if lc_items:
            compact = []
            for item in lc_items:
                if not isinstance(item, dict):
                    continue
                compact.append(
                    {
                        "object_name": item.get("object_name"),
                        "exists": item.get("exists"),
                        "row_count": (item.get("count") or {}).get("total_rows") if isinstance(item.get("count"), dict) else None,
                        "column_names": [
                            col.get("name")
                            for col in ((item.get("columns") or {}).get("columns") or [])
                            if isinstance(col, dict) and col.get("name")
                        ],
                        "columns_error": (item.get("columns") or {}).get("error") if isinstance(item.get("columns"), dict) else None,
                    }
                )
            all_summary["lessons_candidates"] = compact
            all_summary["recommended_lesson_source"] = lessons_candidates.get("recommended_lesson_source")

        if all_summary:
            summary["all_compact"] = all_summary
        else:
            summary["notes"] = ["All report detected but no nested sections were found to summarize."]
        return summary

    summary["notes"] = ["Unsupported or unknown report job type"]
    return summary


def run_summarize_report(args) -> int:
    report_path = Path(args.report).expanduser()
    if not report_path.exists():
        print(f"Report file not found: {report_path}")
        return 2

    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Failed to parse report JSON: {exc}")
        return 2

    summary = summarize_report_payload(payload)
    rendered = json.dumps(summary, ensure_ascii=False, indent=2)

    if args.output:
        out_path = Path(args.output).expanduser()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(rendered, encoding="utf-8")
        print(f"Summary written: {out_path}")
    else:
        print(rendered)
    return 0


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "run":
        return run_noninteractive(args)
    if args.command == "wizard":
        return run_wizard(args)
    if args.command == "summarize-report":
        return run_summarize_report(args)

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())