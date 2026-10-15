"""
build_setup.py
==============
Concatenate the schema and every migration, in order, into setup.sql.

setup.sql is what a new Supabase project runs once to get the complete
database: tables, security rules, functions, triggers and the starting safety
terms. The individual files remain the source of truth; regenerate setup.sql
after adding or changing any of them:

    python supabase/build_setup.py
"""

from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent

# Order matters: later files alter tables and replace functions that earlier
# ones create. Add new migrations to the end.
FILES = [
    "schema.sql",
    "functions_and_triggers.sql",
    "rls_policies.sql",
    "migration_002_ai_provenance.sql",
    "migration_003_lock_role.sql",
    "migration_004_tenant_issue_guard.sql",
    "migration_005_tenant_text_edits.sql",
    "migration_006_resolved_at.sql",
    "migration_007_tenant_signup_trigger.sql",
    "migration_008_safety_terms.sql",
    "migration_009_pre_override_priority.sql",
    "migration_010_table_grants.sql",
]

HEADER = """\
-- ============================================================
--  setup.sql — complete database for the Nepo Mall FIRS
--
--  Run this ONCE on a NEW, empty Supabase project:
--    Supabase dashboard > SQL Editor > New query > paste this whole file > Run
--
--  It creates every table, row-level security policy, function and trigger
--  the system uses, and the starting list of safety terms. It contains no
--  user accounts and no reports.
--
--  Supabase may warn that the query "includes destructive operations". The
--  only ones are DROP ... IF EXISTS statements on objects this script itself
--  creates, so on a new project they remove nothing.
--
--  GENERATED FILE — do not edit. It is the files below, concatenated in
--  order by supabase/build_setup.py:
{listing}
-- ============================================================

"""


def main() -> None:
    listing = "\n".join(f"--    {i:>2}. {name}" for i, name in enumerate(FILES, 1))
    parts = [HEADER.format(listing=listing)]
    for i, name in enumerate(FILES, 1):
        body = (HERE / name).read_text(encoding="utf-8").rstrip() + "\n"
        parts.append(f"\n-- >>>>>>>>>>>>>>>>>>>> {i}/{len(FILES)}  {name} >>>>>>>>>>>>>>>>>>>>\n\n{body}")
    (HERE / "setup.sql").write_text("".join(parts), encoding="utf-8", newline="\n")
    print(f"wrote setup.sql from {len(FILES)} files")


if __name__ == "__main__":
    main()
