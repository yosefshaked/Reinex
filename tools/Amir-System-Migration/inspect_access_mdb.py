#!/usr/bin/env python3
"""Inspect a password-protected Microsoft Access .mdb file.

This utility focuses on discovery first:
- list tables and saved queries
- inspect columns for a table or query
- print sample rows for a table or query
- surface duplicate RiderParents rows by RiderId

It uses the Access OLE DB provider through COM so it can work with a password-
protected .mdb on Windows without requiring pyodbc.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import win32com.client


AD_SCHEMA_TABLES = 20
KNOWN_COMMANDS = {"list", "columns", "sample", "count", "compare-rider-parents"}


def quote_access_name(name: str) -> str:
    return f"[{name.replace(']', ']]')}]"


def open_connection(db_path: Path, password: str | None):
    last_error = None
    for provider in ("Microsoft.ACE.OLEDB.12.0", "Microsoft.Jet.OLEDB.4.0"):
        conn = win32com.client.Dispatch("ADODB.Connection")
        connection_string = f"Provider={provider};Data Source={db_path};Persist Security Info=False;"
        if password:
            connection_string += f"Jet OLEDB:Database Password={password};"
        try:
            conn.Open(connection_string)
            return conn, provider
        except Exception as exc:  # pragma: no cover - depends on local Windows setup
            last_error = exc
    raise RuntimeError(f"failed_to_open_access_database: {last_error}")


def rows_from_recordset(recordset) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    if recordset is None:
        return rows

    field_names = [field.Name for field in recordset.Fields]
    while not recordset.EOF:
        row = {}
        for name in field_names:
            row[name] = recordset.Fields(name).Value
        rows.append(row)
        recordset.MoveNext()

    return rows


def list_objects(conn, include_system: bool) -> list[dict[str, object]]:
    recordset = conn.OpenSchema(AD_SCHEMA_TABLES)
    rows = rows_from_recordset(recordset)
    if not include_system:
        rows = [row for row in rows if not str(row.get("TABLE_NAME", "")).startswith("MSys")]
    return rows


def fetch_columns(conn, object_name: str) -> list[dict[str, object]]:
    sql = f"SELECT TOP 0 * FROM {quote_access_name(object_name)}"
    recordset = conn.Execute(sql)[0]
    columns = []
    for field in recordset.Fields:
        columns.append(
            {
                "name": field.Name,
                "type": field.Type,
                "defined_size": getattr(field, "DefinedSize", None),
                "precision": getattr(field, "Precision", None),
                "numeric_scale": getattr(field, "NumericScale", None),
                "attributes": getattr(field, "Attributes", None),
            }
        )
    return columns


def fetch_rows(conn, object_name: str, limit: int) -> list[dict[str, object]]:
    sql = f"SELECT TOP {int(limit)} * FROM {quote_access_name(object_name)}"
    recordset = conn.Execute(sql)[0]
    return rows_from_recordset(recordset)


def fetch_count(conn, object_name: str) -> int:
    sql = f"SELECT COUNT(*) AS total_rows FROM {quote_access_name(object_name)}"
    recordset = conn.Execute(sql)[0]
    if recordset.EOF:
        return 0
    value = recordset.Fields("total_rows").Value
    return int(value or 0)


def print_table_list(objects, as_json: bool) -> None:
    rows = []
    for row in objects:
        rows.append(
            {
                "name": row.get("TABLE_NAME"),
                "type": row.get("TABLE_TYPE"),
                "created": row.get("DATE_CREATED"),
                "modified": row.get("DATE_MODIFIED"),
            }
        )

    if as_json:
        print(json.dumps(rows, default=str, ensure_ascii=False, indent=2))
        return

    current_type = None
    for row in rows:
        row_type = str(row["type"] or "UNKNOWN")
        if row_type != current_type:
            current_type = row_type
            print(f"\n{current_type}")
        print(f"  {row['name']}")


def print_json(data) -> None:
    print(json.dumps(data, default=str, ensure_ascii=False, indent=2))


def add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("mdb_path", type=Path, help="Path to the .mdb file")
    parser.add_argument("--password", help="Access database password")
    parser.add_argument("--include-system", action="store_true", help="Include MSys* tables in listings")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of text")


def main() -> int:
    argv = sys.argv[1:]
    if argv and argv[0] not in KNOWN_COMMANDS and not argv[0].startswith("-"):
        argv = ["list", *argv]

    parser = argparse.ArgumentParser(description="Inspect a password-protected Microsoft Access .mdb file")
    subparsers = parser.add_subparsers(dest="command", required=False)

    list_parser = subparsers.add_parser("list", help="List tables and saved queries")
    add_common_arguments(list_parser)

    columns_parser = subparsers.add_parser("columns", help="Show columns for a table or query")
    add_common_arguments(columns_parser)
    columns_parser.add_argument("object_name", help="Table or query name")

    sample_parser = subparsers.add_parser("sample", help="Show sample rows for a table or query")
    add_common_arguments(sample_parser)
    sample_parser.add_argument("object_name", help="Table or query name")
    sample_parser.add_argument("--rows", type=int, default=10, help="Number of rows to display")

    count_parser = subparsers.add_parser("count", help="Count rows in a table or query")
    add_common_arguments(count_parser)
    count_parser.add_argument("object_name", help="Table or query name")

    compare_parser = subparsers.add_parser("compare-rider-parents", help="Show duplicate RiderParents rows by RiderId")
    add_common_arguments(compare_parser)
    compare_parser.add_argument("--rows", type=int, default=5000, help="Maximum RiderParents rows to scan")
    compare_parser.add_argument("--rider-id", help="Limit the comparison to one RiderId")

    args = parser.parse_args(argv)
    if args.command is None:
        args.command = "list"

    conn, provider = open_connection(args.mdb_path, args.password)
    try:
        if args.command == "list":
            objects = list_objects(conn, args.include_system)
            if args.json:
                print_json({"provider": provider, "objects": objects})
            else:
                print(f"Provider: {provider}")
                print_table_list(objects, as_json=False)
            return 0

        if args.command == "columns":
            columns = fetch_columns(conn, args.object_name)
            if args.json:
                print_json({"provider": provider, "object_name": args.object_name, "columns": columns})
            else:
                print(f"Provider: {provider}")
                print(f"Object: {args.object_name}")
                for column in columns:
                    print(
                        f"  {column['name']}\t(type={column['type']}, size={column['defined_size']}, precision={column['precision']}, scale={column['numeric_scale']})"
                    )
            return 0

        if args.command == "sample":
            rows = fetch_rows(conn, args.object_name, args.rows)
            if args.json:
                print_json({"provider": provider, "object_name": args.object_name, "rows": rows})
            else:
                writer = csv.writer(sys.stdout)
                print(f"Provider: {provider}")
                print(f"Object: {args.object_name}")
                if not rows:
                    print("No rows returned.")
                else:
                    headers = list(rows[0].keys())
                    writer.writerow(headers)
                    for row in rows:
                        writer.writerow([row.get(header) for header in headers])
            return 0

        if args.command == "count":
            total_rows = fetch_count(conn, args.object_name)
            if args.json:
                print_json({"provider": provider, "object_name": args.object_name, "total_rows": total_rows})
            else:
                print(f"Provider: {provider}")
                print(f"Object: {args.object_name}")
                print(f"Rows: {total_rows}")
            return 0

        if args.command == "compare-rider-parents":
            rows = fetch_rows(conn, "RiderParents", args.rows)
            if args.rider_id is not None:
                rows = [row for row in rows if str(row.get("RiderId")) == str(args.rider_id)]

            groups: dict[str, list[dict[str, object]]] = {}
            for row in rows:
                rider_id = str(row.get("RiderId"))
                groups.setdefault(rider_id, []).append(row)

            duplicates = {rider_id: group for rider_id, group in groups.items() if len(group) > 1}
            if args.json:
                print_json({"provider": provider, "duplicates": duplicates})
            else:
                print(f"Provider: {provider}")
                if not duplicates:
                    print("No duplicate RiderParents rows found in the selected scope.")
                for rider_id, group in duplicates.items():
                    print(f"RiderId {rider_id}: {len(group)} rows")
                    for row in group:
                        print(f"  {row}")
            return 0

        parser.error(f"Unknown command: {args.command}")
        return 2
    finally:
        try:
            conn.Close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())