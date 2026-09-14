import unittest
from datetime import date, datetime

from migration_bundle import (
    build_customers,
    build_guardians,
    build_lessons,
    choose_lesson_candidate,
    date_only,
    normalize_identity,
)


class MigrationBundleTests(unittest.TestCase):
    def test_birth_dates_are_exported_without_a_time_component(self):
        self.assertEqual("2007-04-03", date_only(datetime(2007, 4, 3, 13, 45)))
        self.assertEqual("2007-04-03", date_only(date(2007, 4, 3)))
        self.assertEqual("2007-04-03", date_only("2007-04-03 00:00:00+00:00"))
        self.assertEqual("03/04/2007", date_only("03/04/2007"))

        customers, _, _ = build_customers(
            [{"RiderId": 1, "Id": "123456789", "BirthDay": "2007-04-03 00:00:00"}]
        )
        self.assertEqual("2007-04-03", customers[0]["date_of_birth"])

    def test_identity_normalization_handles_access_legacy_values(self):
        self.assertEqual(("", "legacy_zero_placeholder"), normalize_identity("0"))
        self.assertEqual(("012345678", "leading_zero_restored"), normalize_identity("12345678"))
        self.assertEqual(("123456789", "unchanged"), normalize_identity("123456789"))

    def test_lesson_source_requires_relationship_columns(self):
        candidates = [
            {
                "object_name": "qryRidersLessonsDiary",
                "exists": True,
                "count": {"total_rows": 50000},
                "sample": {"rows": [{"RecordId": 1, "DayofRide": "2026-01-01", "RName": "A"}]},
            },
            {
                "object_name": "qryRiderLessons",
                "exists": True,
                "count": {"total_rows": 49900},
                "sample": {
                    "rows": [
                        {
                            "RecordId": 1,
                            "RiderId": 2,
                            "WorkerID": 3,
                            "DayofRide": "2026-01-01",
                            "HourofRide": "08:30",
                        }
                    ]
                },
            },
        ]

        recommendation = choose_lesson_candidate(candidates)

        self.assertEqual("qryRiderLessons", recommendation["object_name"])
        self.assertTrue(recommendation["signals"]["rider_id"])

    def test_parent_row_expands_to_two_guardians_and_links(self):
        riders = [{"RiderId": 7, "Id": "123456789", "PrivateName": "ילד", "FamilyName": "ישראל"}]
        _, riders_by_id, _ = build_customers(riders)
        parent_rows = [
            {
                "RiderId": 7,
                "FatherName": "אבא",
                "mobileFather": "0501111111",
                "MotherName": "אמא",
                "mobileMother": "0502222222",
            }
        ]

        guardians, links, validation = build_guardians(parent_rows, riders_by_id)

        self.assertEqual(2, len(guardians))
        self.assertEqual({"father", "mother"}, {row["relationship"] for row in guardians})
        self.assertEqual(2, len(links))
        self.assertTrue(all(row["identity_number"] == "123456789" for row in links))
        self.assertTrue(all(row["guardian_last_name"] == "ישראל" for row in guardians))
        self.assertTrue(
            all(row["guardian_last_name_source"] == "student_family_name_suggestion" for row in guardians)
        )
        self.assertEqual(0, validation["orphan_parent_rows"])

    def test_lessons_group_participants_by_record_id(self):
        riders = [
            {"RiderId": 1, "Id": "111111111"},
            {"RiderId": 2, "Id": "222222222"},
        ]
        _, riders_by_id, _ = build_customers(riders)
        source_rows = [
            {
                "RecordId": 90,
                "RiderId": 1,
                "WorkerID": 3,
                "Instractor": "מדריך",
                "DayofRide": "2026-01-01",
                "HourofRide": "08:30",
                "SectionLessonDesc": "פרטני",
                "executed": True,
            },
            {
                "RecordId": 90,
                "RiderId": 2,
                "WorkerID": 3,
                "Instractor": "מדריך",
                "DayofRide": "2026-01-01",
                "HourofRide": "08:30",
                "SectionLessonDesc": "פרטני",
                "executed": True,
            },
        ]

        lessons, participants, instructors, validation = build_lessons(
            source_rows,
            riders_by_id,
            now=datetime(2025, 1, 1),
        )

        self.assertEqual(1, len(lessons))
        self.assertEqual(2, len(participants))
        self.assertEqual(1, len(instructors))
        self.assertEqual(0, validation["orphan_participants"])
        self.assertEqual(0, validation["lessons_with_conflicting_fields"])
        self.assertEqual("scheduled", lessons[0]["lesson_status"])
        self.assertEqual("3", lessons[0]["source_instructor_id"])
        self.assertEqual("3", instructors[0]["source_instructor_id"])
        self.assertTrue(lessons[0]["datetime_start"].startswith("2026-01-01T08:30:00"))
        self.assertTrue(all(row["participant_status"] == "scheduled" for row in participants))

    def test_past_lesson_status_suggestions_preserve_non_arrival(self):
        riders = [{"RiderId": 1, "Id": "111111111"}]
        _, riders_by_id, _ = build_customers(riders)
        source_rows = [{
            "RecordId": 90,
            "RiderId": 1,
            "WorkerID": 3,
            "Instractor": "מדריך ותיק",
            "DayofRide": "2020-01-01",
            "HourofRide": "08:30",
            "SectionLessonDesc": "פרטני",
            "executed": True,
            "Expr1006": "לא הגיעה ולא הודיעה",
        }]

        lessons, participants, instructors, _ = build_lessons(
            source_rows,
            riders_by_id,
            worker_rows=[{
                "WorkerID": 3,
                "FirstName": "מדריך",
                "FamilyName": "ותיק",
                "Active": False,
            }],
            now=datetime(2025, 1, 1),
        )

        self.assertEqual("completed", lessons[0]["lesson_status"])
        self.assertEqual("no_show", participants[0]["participant_status"])
        self.assertEqual("explicit_non_arrival_note", participants[0]["status_inference"])
        self.assertEqual("FALSE", instructors[0]["is_active"])

    def test_customer_validation_flags_duplicate_identity(self):
        rows = [
            {"RiderId": 1, "Id": "123", "PrivateName": "A"},
            {"RiderId": 2, "Id": "123", "PrivateName": "B"},
        ]

        _, _, validation = build_customers(rows)

        self.assertEqual(1, validation["duplicate_identity_numbers"])


if __name__ == "__main__":
    unittest.main()
