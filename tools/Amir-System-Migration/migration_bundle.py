"""Pure helpers for building an Amir MDB migration bundle.

This module deliberately has no Access/COM dependency so its normalization and
validation behavior can be tested on every development platform.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import zipfile
from collections import defaultdict
from datetime import date, datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


BUNDLE_FORMAT = "reinex-import-bundle"
BUNDLE_VERSION = "1.0"
SOURCE_SYSTEM = "amir_mdb"
SOURCE_TIMEZONE = ZoneInfo("Asia/Jerusalem")


def clean(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def key(value) -> str:
    return clean(value).casefold()


def truthy_cell(value) -> str:
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    normalized = key(value)
    if normalized in {"true", "yes", "1", "כן", "פעיל"}:
        return "TRUE"
    if normalized in {"false", "no", "0", "לא", "לא פעיל"}:
        return "FALSE"
    return clean(value)


def date_only(value) -> str:
    """Return an Access date/time value as a date-only ISO string when possible.

    Unknown formats are preserved so they remain visible and repairable in the
    Import Workspace instead of being silently discarded or guessed.
    """
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    text = clean(value)
    match = re.match(r"^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$", text)
    return match.group(1) if match else text


def lesson_datetime(value_date, value_time) -> str:
    """Combine Access date/time cells as an explicit Jerusalem ISO timestamp."""
    date_text = date_only(value_date)
    if not date_text:
        return ""

    if isinstance(value_time, datetime):
        time_value = value_time.time()
    elif isinstance(value_time, time):
        time_value = value_time
    else:
        time_text = clean(value_time)
        match = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", time_text)
        if not match:
            return ""
        time_value = time(
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3) or 0),
        )

    try:
        combined = datetime.combine(date.fromisoformat(date_text), time_value)
    except (TypeError, ValueError):
        return ""
    return combined.replace(tzinfo=SOURCE_TIMEZONE).isoformat()


def normalize_identity(value) -> tuple[str, str]:
    """Normalize only unambiguous legacy ID representations.

    Amir uses 0 for unknown IDs. Access numeric fields also drop the leading zero
    from otherwise nine-digit Israeli identity numbers. Every original value is
    retained beside the normalized field by the callers.
    """
    original = clean(value)
    if original and set(original) == {"0"}:
        return "", "legacy_zero_placeholder"
    if original.isdigit() and len(original) == 8:
        return original.zfill(9), "leading_zero_restored"
    return original, "unchanged"


def split_person_name(value) -> tuple[str, str]:
    """Make a reviewable first/last suggestion while preserving the full name."""
    parts = re.sub(r"\s+", " ", clean(value)).split(" ") if clean(value) else []
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return {
        "file": path.name,
        "row_count": len(rows),
        "columns": columns,
        "sha256": sha256_file(path),
    }


def build_customers(riders: list[dict]) -> tuple[list[dict], dict[str, dict], dict]:
    rows = []
    by_rider_id: dict[str, dict] = {}
    rider_id_counts: defaultdict[str, int] = defaultdict(int)
    identity_counts: defaultdict[str, int] = defaultdict(int)

    for source in riders:
        rider_id = clean(source.get("RiderId"))
        identity_original = clean(source.get("Id"))
        identity_number, identity_action = normalize_identity(identity_original)
        if rider_id:
            rider_id_counts[key(rider_id)] += 1
            by_rider_id.setdefault(key(rider_id), source)
        if identity_number:
            identity_counts[key(identity_number)] += 1
        rows.append(
            {
                "source_rider_id": rider_id,
                "first_name": clean(source.get("PrivateName")),
                "last_name": clean(source.get("FamilyName")),
                "identity_number": identity_number,
                "legacy_identity_number_original": identity_original,
                "identity_normalization": identity_action,
                "customer_type": "student",
                "is_active": truthy_cell(source.get("Active")),
                "phone": clean(source.get("SelolarPhon") or source.get("PhonHome") or source.get("PhonAnother")),
                "secondary_phone": clean(source.get("PhonHome") or source.get("PhonAnother")),
                "email": clean(source.get("Email")),
                "date_of_birth": date_only(source.get("BirthDay")),
                "note_text": clean(source.get("Remark")),
                "legacy_section": clean(source.get("Section")),
                "legacy_sector": clean(source.get("Sector")),
                "legacy_permanent_instructor": clean(source.get("PermanentInstractor")),
                "legacy_last_update": clean(source.get("LastUpdate")),
            }
        )

    validation = {
        "source_rows": len(riders),
        "emitted_rows": len(rows),
        "missing_source_rider_id": sum(1 for row in rows if not row["source_rider_id"]),
        "duplicate_source_rider_ids": sum(1 for count in rider_id_counts.values() if count > 1),
        "missing_identity_numbers": sum(1 for row in rows if not row["identity_number"]),
        "duplicate_identity_numbers": sum(1 for count in identity_counts.values() if count > 1),
        "legacy_zero_identity_placeholders": sum(
            1 for row in rows if row["identity_normalization"] == "legacy_zero_placeholder"
        ),
        "identity_numbers_with_leading_zero_restored": sum(
            1 for row in rows if row["identity_normalization"] == "leading_zero_restored"
        ),
    }
    return rows, by_rider_id, validation


PARENT_SPECS = (
    {
        "relationship": "father",
        "name": "FatherName",
        "mobile": "mobileFather",
        "phone": "PhonFather",
        "identity": "tzFather",
        "email": "eMailFather",
        "profession": "ProfationFather",
        "workplace": "WorkPlaceFather",
        "duty": "DutyFather",
    },
    {
        "relationship": "mother",
        "name": "MotherName",
        "mobile": "mobileMother",
        "phone": "PhonMother",
        "identity": "tzMother",
        "email": "eMailMother",
        "profession": "ProfationMother",
        "workplace": "WorkPlaceMother",
        "duty": "DutyMother",
    },
)


def build_guardians(parent_rows: list[dict], riders_by_id: dict[str, dict]) -> tuple[list[dict], list[dict], dict]:
    guardians = []
    links = []
    orphan_parent_rows = 0
    surname_suggestions = 0

    for source_index, source in enumerate(parent_rows, start=1):
        rider_id = clean(source.get("RiderId"))
        rider = riders_by_id.get(key(rider_id))
        if not rider:
            orphan_parent_rows += 1
        student_identity, _ = normalize_identity((rider or {}).get("Id"))

        for spec in PARENT_SPECS:
            full_name = clean(source.get(spec["name"]))
            mobile = clean(source.get(spec["mobile"]))
            phone = mobile or clean(source.get(spec["phone"]))
            email = clean(source.get(spec["email"]))
            guardian_identity_original = clean(source.get(spec["identity"]))
            guardian_identity, guardian_identity_action = normalize_identity(guardian_identity_original)
            has_parent = any((full_name, phone, email, guardian_identity))
            if not has_parent:
                continue

            first_name, last_name = split_person_name(full_name)
            last_name_source = "parent_name"
            if not last_name and clean((rider or {}).get("FamilyName")):
                # Amir stores almost all parent names as a first name only. Inherit a
                # visible, reviewable suggestion rather than fabricating a silent fact.
                last_name = clean(rider.get("FamilyName"))
                last_name_source = "student_family_name_suggestion"
                surname_suggestions += 1
            guardian_key = f"{rider_id or 'row-' + str(source_index)}:{spec['relationship']}"
            guardians.append(
                {
                    "source_guardian_key": guardian_key,
                    "source_rider_id": rider_id,
                    "guardian_first_name": first_name,
                    "guardian_last_name": last_name,
                    "guardian_last_name_source": last_name_source,
                    "guardian_full_name_original": full_name,
                    "guardian_phone": phone,
                    "guardian_secondary_phone": clean(source.get(spec["phone"])) if mobile else "",
                    "guardian_email": email,
                    "guardian_identity_number": guardian_identity,
                    "guardian_identity_number_original": guardian_identity_original,
                    "guardian_identity_normalization": guardian_identity_action,
                    "relationship": spec["relationship"],
                    "legacy_profession": clean(source.get(spec["profession"])),
                    "legacy_workplace": clean(source.get(spec["workplace"])),
                    "legacy_duty": clean(source.get(spec["duty"])),
                }
            )
            links.append(
                {
                    "source_guardian_key": guardian_key,
                    "source_rider_id": rider_id,
                    "identity_number": student_identity,
                    "guardian_phone": phone,
                    "guardian_email": email,
                    "relationship": spec["relationship"],
                    "is_primary": "",
                }
            )

    validation = {
        "source_rows": len(parent_rows),
        "emitted_guardians": len(guardians),
        "emitted_links": len(links),
        "orphan_parent_rows": orphan_parent_rows,
        "guardians_using_student_family_name_suggestion": surname_suggestions,
        "guardians_missing_first_name": sum(1 for row in guardians if not row["guardian_first_name"]),
        "guardians_missing_last_name": sum(1 for row in guardians if not row["guardian_last_name"]),
        "guardians_missing_contact": sum(
            1 for row in guardians if not row["guardian_phone"] and not row["guardian_email"]
        ),
        "links_missing_student_identity": sum(1 for row in links if not row["identity_number"]),
    }
    return guardians, links, validation


def build_services(section_rows: list[dict], lesson_rows: list[dict]) -> tuple[list[dict], dict]:
    services: dict[str, dict] = {}
    for source in section_rows:
        name = clean(source.get("SectionLessonDesc"))
        if name:
            services.setdefault(
                key(name),
                {
                    "source_system": SOURCE_SYSTEM,
                    "source_service_id": clean(source.get("SectionLessonId")),
                    "service_name": name,
                    "duration_minutes": "",
                    "description": "",
                },
            )
    for source in lesson_rows:
        name = clean(source.get("SectionLessonDesc"))
        if name:
            services.setdefault(
                key(name),
                {
                    "source_system": SOURCE_SYSTEM,
                    "source_service_id": clean(source.get("Section")),
                    "service_name": name,
                    "duration_minutes": "",
                    "description": "",
                },
            )
    rows = list(services.values())
    return rows, {"emitted_rows": len(rows), "source_section_rows": len(section_rows)}


LESSON_FIELDS = {
    "lesson_date": "DayofRide",
    "lesson_time": "HourofRide",
    "source_worker_id": "WorkerID",
    "instructor_name": "Instractor",
    "service_name": "SectionLessonDesc",
    "source_service_id": "Section",
    "sector_name": "SectorDesc",
    "executed": "executed",
    "horse_name": "HorseDec",
    "unexecuted_reason": "UnexecutedReson",
    "legacy_section_note": "secRemark",
}


def _first_and_conflicts(group: list[tuple[int, dict]], source_field: str) -> tuple[str, bool]:
    values = [clean(row.get(source_field)) for _, row in group if clean(row.get(source_field))]
    distinct = list(dict.fromkeys(values))
    return (distinct[0] if distinct else ""), len({key(value) for value in distinct}) > 1


def build_lessons(
    lesson_rows: list[dict],
    riders_by_id: dict[str, dict],
    worker_rows: list[dict] | None = None,
    now: datetime | None = None,
) -> tuple[list[dict], list[dict], list[dict], dict]:
    groups: defaultdict[str, list[tuple[int, dict]]] = defaultdict(list)
    missing_record_id = 0
    for row_index, source in enumerate(lesson_rows, start=1):
        record_id = clean(source.get("RecordId"))
        if not record_id:
            record_id = f"missing-record-{row_index}"
            missing_record_id += 1
        groups[record_id].append((row_index, source))

    lessons = []
    participants = []
    instructor_map: dict[str, dict] = {}
    conflicting_lessons = 0
    orphan_participants = 0
    missing_rider_id = 0

    effective_now = now or datetime.now(SOURCE_TIMEZONE)
    if effective_now.tzinfo is None:
        effective_now = effective_now.replace(tzinfo=SOURCE_TIMEZONE)

    for record_id, group in groups.items():
        lesson = {
            "source_system": SOURCE_SYSTEM,
            "source_lesson_id": record_id,
            "source_row_count": len(group),
        }
        conflicts = []
        for target, source_field in LESSON_FIELDS.items():
            value, conflict = _first_and_conflicts(group, source_field)
            lesson[target] = truthy_cell(value) if target == "executed" else value
            if conflict:
                conflicts.append(source_field)
        lesson["conflicting_fields"] = ",".join(conflicts)
        lesson["datetime_start"] = lesson_datetime(lesson["lesson_date"], lesson["lesson_time"])
        parsed_start = None
        try:
            parsed_start = datetime.fromisoformat(lesson["datetime_start"]) if lesson["datetime_start"] else None
        except ValueError:
            parsed_start = None
        is_future = bool(parsed_start and parsed_start > effective_now)
        is_executed = truthy_cell(lesson["executed"]) == "TRUE"
        if not is_executed:
            lesson["lesson_status"] = "cancelled"
            lesson["status_inference"] = "legacy_marked_not_executed"
        elif is_future:
            lesson["lesson_status"] = "scheduled"
            lesson["status_inference"] = "future_active_lesson"
        else:
            lesson["lesson_status"] = "completed"
            lesson["status_inference"] = "past_active_lesson"
        lesson["duration_minutes"] = ""
        if conflicts:
            conflicting_lessons += 1
        lessons.append(lesson)

        worker_id = lesson["source_worker_id"]
        instructor_name = lesson["instructor_name"]
        source_instructor_id = worker_id or (f"name:{key(instructor_name)}" if instructor_name else "")
        lesson["source_instructor_id"] = source_instructor_id
        if source_instructor_id:
            instructor_key = key(source_instructor_id)
            instructor_map.setdefault(
                instructor_key,
                {
                    "source_system": SOURCE_SYSTEM,
                    "source_instructor_id": source_instructor_id,
                    "source_worker_id": worker_id,
                    "first_name": split_person_name(instructor_name)[0],
                    "middle_name": "",
                    "last_name": split_person_name(instructor_name)[1],
                    "instructor_name": instructor_name,
                    "is_active": "FALSE",
                },
            )

        seen_riders = set()
        for row_index, source in group:
            rider_id = clean(source.get("RiderId"))
            if not rider_id:
                missing_rider_id += 1
            rider = riders_by_id.get(key(rider_id))
            if rider_id and not rider:
                orphan_participants += 1
            participant_identity, _ = normalize_identity((rider or {}).get("Id"))
            participant_key = key(rider_id) or f"row:{row_index}"
            if participant_key in seen_riders:
                continue
            seen_riders.add(participant_key)
            participants.append(
                {
                    "source_system": SOURCE_SYSTEM,
                    "source_lesson_id": record_id,
                    "source_rider_id": rider_id,
                    "identity_number": participant_identity,
                    "participant_status": (
                        "cancelled_clinic"
                        if not is_executed
                        else "scheduled"
                        if is_future
                        else "no_show"
                        if re.search(r"לא\s+הגיע(?:ה)?", clean(source.get("Expr1006") or source.get("UnexecutedReson")))
                        else "attended"
                    ),
                    "status_inference": (
                        "legacy_marked_not_executed"
                        if not is_executed
                        else "future_active_lesson"
                        if is_future
                        else "explicit_non_arrival_note"
                        if re.search(r"לא\s+הגיע(?:ה)?", clean(source.get("Expr1006") or source.get("UnexecutedReson")))
                        else "past_active_lesson"
                    ),
                    "legacy_attendance_note": clean(source.get("Expr1006") or source.get("UnexecutedReson")),
                    "source_row_number": row_index,
                    "participant_price": clean(source.get("RiderPartPrice") or source.get("Price")),
                    "funding_method": clean(source.get("FundingWayDesc")),
                    "payment_status": clean(source.get("payStatus")),
                    "invoice": clean(source.get("invoice")),
                }
            )

    worker_by_id = {key(row.get("WorkerID")): row for row in (worker_rows or []) if clean(row.get("WorkerID"))}
    for instructor in instructor_map.values():
        worker = worker_by_id.get(key(instructor["source_instructor_id"]))
        if not worker:
            continue
        instructor["first_name"] = clean(worker.get("FirstName")) or instructor["first_name"]
        instructor["middle_name"] = clean(worker.get("MiddelName"))
        instructor["last_name"] = clean(worker.get("FamilyName")) or instructor["last_name"]
        instructor["instructor_name"] = " ".join(
            part for part in (instructor["first_name"], instructor["middle_name"], instructor["last_name"]) if part
        )
        instructor["is_active"] = truthy_cell(worker.get("Active"))

    validation = {
        "source_rows": len(lesson_rows),
        "emitted_lessons": len(lessons),
        "emitted_participants": len(participants),
        "missing_record_ids": missing_record_id,
        "missing_rider_ids": missing_rider_id,
        "orphan_participants": orphan_participants,
        "lessons_with_conflicting_fields": conflicting_lessons,
        "participants_by_status": {
            status: sum(1 for row in participants if row["participant_status"] == status)
            for status in ("scheduled", "attended", "no_show", "cancelled_student", "cancelled_clinic")
        },
    }
    return lessons, participants, list(instructor_map.values()), validation


def lesson_candidate_columns(candidate: dict) -> list[str]:
    columns = ((candidate.get("columns") or {}).get("columns") or [])
    names = [clean(column.get("name")) for column in columns if isinstance(column, dict) and column.get("name")]
    if names:
        return names
    sample_rows = ((candidate.get("sample") or {}).get("rows") or [])
    if sample_rows and isinstance(sample_rows[0], dict):
        return list(sample_rows[0].keys())
    return []


def score_lesson_candidate(candidate: dict) -> dict:
    names = lesson_candidate_columns(candidate)
    normalized = {key(name) for name in names}
    signals = {
        "rider_id": "riderid" in normalized,
        "record_id": "recordid" in normalized,
        "worker_id": "workerid" in normalized,
        "date": "dayofride" in normalized,
        "time": "hourofride" in normalized,
        "service": bool({"sectionlessondesc", "section"} & normalized),
    }
    score = 0
    score += 40 if signals["rider_id"] else -50
    score += 40 if signals["record_id"] else -50
    score += 8 if signals["worker_id"] else 0
    score += 8 if signals["date"] else 0
    score += 4 if signals["time"] else 0
    score += 4 if signals["service"] else 0
    return {"score": score, "columns": names, "signals": signals}


def choose_lesson_candidate(candidates: list[dict]) -> dict | None:
    ranked = []
    for candidate in candidates:
        if not isinstance(candidate, dict) or not candidate.get("exists"):
            continue
        count_payload = candidate.get("count") if isinstance(candidate.get("count"), dict) else {}
        try:
            row_count = int(count_payload.get("total_rows") or 0)
        except (TypeError, ValueError):
            row_count = 0
        if row_count <= 0:
            continue
        scored = score_lesson_candidate(candidate)
        ranked.append((scored["score"], row_count, clean(candidate.get("object_name")), scored))
    if not ranked:
        return None
    score, row_count, object_name, scored = max(ranked, key=lambda item: (item[0], item[1], item[2]))
    return {
        "object_name": object_name,
        "reason": "relationship_columns_then_row_count",
        "row_count": row_count,
        "score": score,
        "signals": scored["signals"],
        "column_names": scored["columns"],
    }


def create_zip(bundle_dir: Path) -> Path:
    zip_path = bundle_dir.with_suffix(".zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(bundle_dir.rglob("*")):
            if path.is_file():
                archive.write(path, arcname=path.relative_to(bundle_dir))
    return zip_path


def write_manifest(path: Path, payload: dict) -> dict:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
    path.write_text(rendered, encoding="utf-8")
    return {
        "file": path.name,
        "sha256": sha256_file(path),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "format": BUNDLE_FORMAT,
        "format_version": BUNDLE_VERSION,
    }
