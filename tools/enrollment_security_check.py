"""Read-only verification of newly deployed private enrollment tables."""
import argparse
import json
from dotenv import dotenv_values
import psycopg

parser = argparse.ArgumentParser(); parser.add_argument("--env-file", required=True)
args = parser.parse_args(); values = dotenv_values(args.env_file)
with psycopg.connect(host=values["POSTGRES_HOST"], port=values["POSTGRES_PORT"], dbname=values["POSTGRES_DB"], user=values["POSTGRES_USER"], password=values["POSTGRES_PASSWORD"], sslmode="require", connect_timeout=15) as connection:
    rows = connection.execute("SELECT relname, relrowsecurity, has_table_privilege('anon', oid, 'SELECT'), has_table_privilege('authenticated', oid, 'SELECT') FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('player_enrollments', 'player_enrollment_invitations', 'player_enrollment_documents') ORDER BY relname").fetchall()
    assert len(rows) == 3 and all(row[1] and not row[2] and not row[3] for row in rows)
    print(json.dumps({"private_tables": rows, "project": values["POSTGRES_USER"].split(".")[-1]}))
