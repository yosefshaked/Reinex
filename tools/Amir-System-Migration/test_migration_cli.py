import unittest
from pathlib import Path
from unittest.mock import patch

from migration_cli import build_base_report, safe_columns


class _Field:
    def __init__(self, name):
        self.Name = name
        self.Type = 202
        self.DefinedSize = 255
        self.Precision = 0
        self.NumericScale = 0
        self.Attributes = 0


class _Recordset:
    Fields = [_Field("RiderId"), _Field("RecordId")]


class _Connection:
    def Execute(self, sql):
        if "TOP 1" not in sql:
            raise AssertionError(f"Unexpected fallback SQL: {sql}")
        return [_Recordset()]


class MigrationCliTests(unittest.TestCase):
    def test_column_discovery_falls_back_when_top_zero_throws(self):
        with patch("migration_cli.fetch_columns", side_effect=RuntimeError("TOP 0 rejected")):
            result = safe_columns(_Connection(), "qryRiderLessons")

        self.assertTrue(result["ok"])
        self.assertEqual("top1-fallback", result["method"])
        self.assertEqual(["RiderId", "RecordId"], [column["name"] for column in result["columns"]])

    def test_base_report_does_not_expose_absolute_mdb_path(self):
        report = build_base_report(
            Path("C:/Sensitive/Customer Name/legacy.mdb"),
            "provider",
            "bundle",
            {},
            "success",
        )

        self.assertNotIn("mdb_path", report)
        self.assertEqual("legacy.mdb", report["mdb_file_name"])


if __name__ == "__main__":
    unittest.main()
