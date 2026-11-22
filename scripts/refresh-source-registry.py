"""Manually refresh the source catalogue on the authorised RegPilot staging database.

Use standard libpq configuration (PGSERVICE or PGHOST, PGUSER, PGDATABASE and
an approved password file). Requires the staging registry operator privileges.
"""
import subprocess
import sys
import time


def query(statement):
    result = subprocess.run(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", statement],
                            check=True, text=True, stdout=subprocess.PIPE)
    return int(result.stdout.strip())


if __name__ == "__main__":
    try:
        print("Definitions imported:", query("SELECT regpilot_verification.refresh_source_registry()"))
        while query("SELECT regpilot_verification.check_source_artifacts(10)"):
            time.sleep(3)
        count = query("SELECT count(*) FROM regpilot_verification.source_collection_plans WHERE artifact_verified")
        print("Plans with current image checks:", count)
        pending = query("SELECT count(*) FROM regpilot_verification.source_collection_plans WHERE plan_available AND NOT artifact_verified")
        if pending:
            print("Eligible plans awaiting a successful image check:", pending)
            sys.exit(1)
    except (OSError, ValueError, subprocess.SubprocessError):
        sys.exit("Staging registry refresh failed. Check the operator connection and database response.")
