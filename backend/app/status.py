"""The ONE definition of complaint statuses and of "open".

Every query that needs "open" uses OPEN_SQL / open_sql() (which calls the SQL function ireport_is_open(),
created in migration 0011) and every Python check uses is_open(). tests/test_workflow.py proves the two
agree for every enum value. Do not write `status <> 'Resolved'` anywhere.
"""

# Lifecycle: Reported -> Acknowledged -> Scheduled -> In Progress -> Resolved -> Closed
LIFECYCLE = ("Reported", "Acknowledged", "Scheduled", "In Progress", "Resolved", "Closed")
# Side states. "Transferred" is recorded in status_events only: after a transfer the complaint re-enters the
# new department's queue as Reported (README.md (Design decisions), workflow section).
SIDE = ("Reopened", "On Hold", "Rejected", "Duplicate", "Transferred")
STATUSES = (*LIFECYCLE, *SIDE)

OPEN_STATUSES = ("Reported", "Acknowledged", "Scheduled", "In Progress", "Reopened", "On Hold")
# Not open: waiting for the citizen (Resolved) or finished (everything else).
NOT_OPEN_STATUSES = tuple(s for s in STATUSES if s not in OPEN_STATUSES)
# An officer cannot move a complaint out of these.
LOCKED_STATUSES = ("Closed", "Rejected", "Duplicate")


def is_open(status: str) -> bool:
    return status in OPEN_STATUSES


def open_sql(alias: str = "i") -> str:
    """SQL boolean expression: is this incident open. Uses the immutable function so it can be indexed."""
    col = f"{alias}.status" if alias else "status"
    return f"ireport_is_open({col})"


def closed_sql(alias: str = "i") -> str:
    return f"NOT ireport_is_open({alias}.status)" if alias else "NOT ireport_is_open(status)"
