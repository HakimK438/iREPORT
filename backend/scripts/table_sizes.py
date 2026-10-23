"""Print table sizes (data + indexes) and bytes per row, plus the cost of one report's row set.

    cd backend && python -m scripts.table_sizes
"""

import asyncio

from sqlalchemy import text

from app.db import engine

TABLES = ["incidents", "reports", "media", "status_events", "messages", "confirmations", "users", "authority_profiles", "refresh_tokens", "wards", "categories", "departments"]


async def main() -> None:
    async with engine.connect() as conn:
        rows = []
        for t in TABLES:
            r = (await conn.execute(text(f"""SELECT (SELECT count(*) FROM {t}) AS n, pg_table_size('{t}') AS data,
                                                    pg_indexes_size('{t}') AS idx, pg_total_relation_size('{t}') AS total""" ))).one()
            rows.append((t, r.n, r.data, r.idx, r.total))
        avg = {t: (await conn.scalar(text(f"SELECT coalesce(avg(pg_column_size(x.*)), 0) FROM (SELECT * FROM {t} LIMIT 20000) x"))) for t in ("incidents", "reports", "media", "status_events")}
    await engine.dispose()
    print(f"{'table':<20}{'rows':>10}{'data':>12}{'indexes':>12}{'total':>12}{'B/row':>9}")
    for t, n, data, idx, total in rows:
        print(f"{t:<20}{n:>10}{data / 1024:>10.0f}KB{idx / 1024:>10.0f}KB{total / 1024:>10.0f}KB{(total / n if n else 0):>9.0f}")
    # A report creates: one reports row, and (if new) one incident + one status event, plus 0-3 media rows.
    tuple_bytes = avg["reports"] + avg["incidents"] + avg["status_events"] + avg["media"]
    print(f"\naverage tuple sizes: {', '.join(f'{k}={float(v):.0f} B' for k, v in avg.items())}")
    print(f"one new report row set (report + incident + status event + 1 photo row), without indexes: ~{float(tuple_bytes):.0f} B")


if __name__ == "__main__":
    asyncio.run(main())
