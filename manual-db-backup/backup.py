#!/usr/bin/env python3
"""
Supabase Online DB Backup Tool
Uses: supabase db dump (https://supabase.com/docs/reference/cli/supabase-db-dump)

Requires the Supabase CLI to be installed:
  https://supabase.com/docs/guides/local-development/cli/getting-started
"""

import subprocess
import sys
import os
import shutil
from datetime import datetime
from pathlib import Path

# ── Helpers ───────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent.resolve()
BACKUPS_DIR = SCRIPT_DIR / "backups"

CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

# On Windows, supabase may be installed as a .cmd/.bat wrapper (npm, Scoop).
# shell=True is required to launch those wrappers via subprocess.
SHELL = sys.platform == "win32"


def banner():
    print(f"\n{BOLD}{CYAN}{'═' * 58}{RESET}")
    print(f"{BOLD}{CYAN}  Supabase Manual DB Backup{RESET}")
    print(f"{BOLD}{CYAN}  supabase db dump  ·  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{RESET}")
    print(f"{BOLD}{CYAN}{'═' * 58}{RESET}\n")


def ask(prompt, default=None):
    suffix = f" [{default}]" if default else ""
    try:
        value = input(f"{YELLOW}{prompt}{suffix}: {RESET}").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)
    return value if value else default


def choose(prompt, options, default=1):
    print(f"\n{YELLOW}{prompt}{RESET}")
    for i, (label, _) in enumerate(options, 1):
        marker = f"{GREEN}(default){RESET}" if i == default else ""
        print(f"  {BOLD}{i}{RESET}. {label} {marker}")
    raw = ask("Enter choice", str(default))
    try:
        idx = int(raw) - 1
        if 0 <= idx < len(options):
            return options[idx][1]
    except (ValueError, TypeError):
        pass
    return options[default - 1][1]


def check_supabase_cli():
    if shutil.which("supabase") is None:
        print(f"\n{RED}ERROR: 'supabase' CLI not found in PATH.{RESET}")
        print("Install it from: https://supabase.com/docs/guides/local-development/cli/getting-started")
        print("  Windows (Scoop):  scoop bucket add supabase https://github.com/supabase/scoop-bucket.git")
        print("                    scoop install supabase")
        print("  Windows (npm):    npm install -g supabase")
        input("\nPress Enter to exit...")
        sys.exit(1)


def supabase_login():
    """Run supabase login — opens browser or accepts a token."""
    print(f"\n{CYAN}Running: supabase login{RESET}")
    print(f"{YELLOW}A browser window will open (or paste your access token).{RESET}")
    print(f"Get a token at: {BOLD}https://supabase.com/dashboard/account/tokens{RESET}\n")
    ret = subprocess.run(["supabase", "login"], shell=SHELL)
    if ret.returncode != 0:
        print(f"\n{RED}Login failed.{RESET}")
        return False
    print(f"\n{GREEN}Logged in successfully.{RESET}")
    return True


def supabase_link(project_ref, db_pass=None):
    """Run supabase link for the given project ref."""
    print(f"\n{CYAN}Linking project {project_ref}…{RESET}")
    link_cmd = ["supabase", "link", "--project-ref", project_ref]
    if db_pass:
        link_cmd += ["-p", db_pass]
    ret = subprocess.run(link_cmd, shell=SHELL)
    if ret.returncode != 0:
        print(f"\n{RED}Linking failed. Check the project ref and password.{RESET}")
        return False
    print(f"\n{GREEN}Project linked successfully.{RESET}")
    return True


def run_dump(args, output_file):
    cmd = ["supabase", "db", "dump"] + args + ["-f", str(output_file)]
    print(f"\n{CYAN}Running:{RESET} {' '.join(cmd)}\n")
    result = subprocess.run(cmd, shell=SHELL)
    return result.returncode == 0


# ── Main flow ─────────────────────────────────────────────────────────────────

def main():
    # Enable ANSI colours on Windows
    if sys.platform == "win32":
        os.system("")

    banner()
    check_supabase_cli()

    # ── 0. Auth / login ──────────────────────────────────────────────────────
    do_login = choose(
        "Do you want to log in to Supabase first?",
        [
            ("Skip  (already logged in)", "skip"),
            ("Login (opens browser or prompts for access token)", "login"),
        ],
        default=1,
    )
    if do_login == "login":
        if not supabase_login():
            input("\nPress Enter to exit...")
            sys.exit(1)

    # ── 1. Connection method ─────────────────────────────────────────────────
    connection_type = choose(
        "How do you want to connect to the remote database?",
        [
            ("Linked project  (uses already-linked project credentials)", "linked"),
            ("Link now        (enter project ref — runs 'supabase link')", "ref"),
            ("Direct DB URL   (postgres://user:password@host:port/db)", "dburl"),
        ],
        default=1,
    )

    extra_flags = []

    if connection_type == "linked":
        extra_flags.append("--linked")

    elif connection_type == "dburl":
        db_url = ask("Enter your DB connection string (percent-encode special chars in password)")
        if not db_url:
            print(f"{RED}No URL entered. Aborting.{RESET}")
            sys.exit(1)
        extra_flags += ["--db-url", db_url]

    else:  # ref
        project_ref = ask("Enter your Supabase project ref (20-char string from dashboard URL)")
        if not project_ref:
            print(f"{RED}No project ref entered. Aborting.{RESET}")
            sys.exit(1)
        db_pass = ask("Enter your database password (leave blank to be prompted by CLI)")
        if not supabase_link(project_ref, db_pass or None):
            input("\nPress Enter to exit...")
            sys.exit(1)
        extra_flags.append("--linked")

    # ── 2. Schema filter ────────────────────────────────────────────────────
    print(f"\n{YELLOW}Schema filter{RESET}")
    print("  Leave blank to dump ALL schemas (recommended for full backup).")
    print("  Or enter a comma-separated list, e.g.:  public,auth,storage")
    schema_input = ask("Schemas to include (blank = all)") or ""
    schemas = [s.strip() for s in schema_input.split(",") if s.strip()]
    if schemas:
        # supabase CLI accepts -s as repeated flags or comma-separated
        extra_flags += ["-s", ",".join(schemas)]

    # ── 3. Dump type ─────────────────────────────────────────────────────────
    dump_type = choose(
        "What do you want to dump?",
        [
            ("Schema only      (DDL — table structure, functions, policies, …)", "schema"),
            ("Data only        (INSERT/COPY rows, no schema)", "data"),
            ("Roles only       (cluster-level roles)", "roles"),
            ("Full backup      (schema + data + roles — 3 separate files)", "full"),
        ],
        default=1,
    )

    # ── 4. Output folder (created lazily on first successful dump) ────────────
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_dir = BACKUPS_DIR / timestamp
    print(f"\n{CYAN}Output folder:{RESET} {out_dir}\n")

    # ── 5. Run dump(s) ────────────────────────────────────────────────────────
    jobs = []
    if dump_type == "schema":
        jobs.append((extra_flags[:], out_dir / "schema.sql", "schema"))
    elif dump_type == "data":
        jobs.append((extra_flags + ["--data-only"], out_dir / "data.sql", "data"))
    elif dump_type == "roles":
        jobs.append((extra_flags + ["--role-only"], out_dir / "roles.sql", "roles"))
    else:  # full
        jobs.append((extra_flags[:],                              out_dir / "schema.sql", "schema"))
        jobs.append((extra_flags + ["--data-only"],               out_dir / "data.sql",   "data"))
        jobs.append((extra_flags + ["--role-only"],               out_dir / "roles.sql",  "roles"))

    all_ok = True
    any_saved = False
    for flags, outfile, label in jobs:
        print(f"{BOLD}[{label.upper()}]{RESET}")
        out_dir.mkdir(parents=True, exist_ok=True)  # create on first attempt
        ok = run_dump(flags, outfile)
        if ok and outfile.exists() and outfile.stat().st_size > 0:
            size = outfile.stat().st_size
            print(f"{GREEN}✔ Saved:{RESET} {outfile.name}  ({size:,} bytes)\n")
            any_saved = True
        else:
            # Remove empty/missing file so the folder stays clean
            if outfile.exists():
                outfile.unlink()
            print(f"{RED}✘ Dump failed for: {label}{RESET}\n")
            all_ok = False

    # Remove the folder if nothing was written to it
    if not any_saved and out_dir.exists():
        try:
            out_dir.rmdir()  # only removes if empty
        except OSError:
            pass

    # ── 6. Summary ────────────────────────────────────────────────────────────
    print(f"{BOLD}{CYAN}{'─' * 58}{RESET}")
    if all_ok and any_saved:
        print(f"{GREEN}{BOLD}Backup complete!{RESET}")
        print(f"Files saved in: {out_dir}")
    elif any_saved:
        print(f"{YELLOW}{BOLD}Partial backup — some dumps failed. Check output above.{RESET}")
        print(f"Files saved in: {out_dir}")
    else:
        print(f"{RED}{BOLD}Nothing was backed up. No folder created.{RESET}")
    print(f"{BOLD}{CYAN}{'─' * 58}{RESET}\n")

    input("Press Enter to exit...")


if __name__ == "__main__":
    main()
