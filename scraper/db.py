"""
Supabase DB operations for the Maine BMV scraper.
Uses the service_role key so it can write past RLS.
"""
import os
from datetime import date, datetime, timezone
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

BOOK_URL = "https://mainebmvappt.cxmflow.com/Appointment/Index/2c052fc7-571f-4b76-9790-7e91f103c408"
GOLDEN_THRESHOLD_DAYS = 8


def get_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_golden_slot(db: Client, office: str, appt_date: date, appt_time: str) -> bool:
    """
    Insert or refresh a golden slot (<8 days away).
    Returns True if this is a brand-new slot (triggers alert).
    """
    date_str = appt_date.isoformat()
    now = now_utc()

    # Check if this exact slot already exists
    existing = (
        db.table("appointments")
        .select("id, available, first_seen_at")
        .eq("office", office)
        .eq("appointment_date", date_str)
        .eq("appointment_time", appt_time)
        .eq("slot_type", "golden")
        .execute()
    )

    if existing.data:
        row = existing.data[0]
        # Update last_seen and ensure available=true (it might have reappeared)
        db.table("appointments").update({
            "last_seen_at": now,
            "available": True,
        }).eq("id", row["id"]).execute()
        # It's "new" if it was previously marked unavailable (reappeared)
        return not row["available"]
    else:
        # New slot
        db.table("appointments").insert({
            "office": office,
            "appointment_type": "Driver's License",
            "appointment_date": date_str,
            "appointment_time": appt_time,
            "slot_type": "golden",
            "is_golden": True,
            "is_current_closest": False,
            "available": True,
            "first_seen_at": now,
            "last_seen_at": now,
            "book_url": BOOK_URL,
        }).execute()
        return True


def upsert_future_slot(db: Client, office: str, closest_date: date) -> bool:
    """
    Track the closest future date (>=8 days) for an office.
    One active 'current closest' record per office at a time.
    Returns True if a new record was created.
    """
    date_str = closest_date.isoformat()
    now = now_utc()

    # Find current active closest for this office
    existing = (
        db.table("appointments")
        .select("id, appointment_date, available")
        .eq("office", office)
        .eq("slot_type", "future")
        .eq("is_current_closest", True)
        .execute()
    )

    if existing.data:
        row = existing.data[0]
        existing_date = row["appointment_date"]

        if existing_date == date_str:
            # Same date — just refresh last_seen, ensure available
            db.table("appointments").update({
                "last_seen_at": now,
                "available": True,
            }).eq("id", row["id"]).execute()
            return False
        elif closest_date < date.fromisoformat(existing_date):
            # Closer date found — retire old record, create new one
            db.table("appointments").update({
                "is_current_closest": False,
                "replaced_at": now,
                "replaced_by_date": date_str,
                "available": False,
            }).eq("id", row["id"]).execute()
            # Fall through to insert new
        else:
            # Existing record has a closer or equal date, nothing to do
            db.table("appointments").update({
                "last_seen_at": now,
                "available": True,
            }).eq("id", row["id"]).execute()
            return False

    # Insert new closest-future record
    db.table("appointments").insert({
        "office": office,
        "appointment_type": "Driver's License",
        "appointment_date": date_str,
        "appointment_time": None,
        "slot_type": "future",
        "is_golden": False,
        "is_current_closest": True,
        "available": True,
        "first_seen_at": now,
        "last_seen_at": now,
        "book_url": BOOK_URL,
    }).execute()
    return True


def mark_golden_gone(db: Client, office: str, still_available: set[tuple]) -> None:
    """
    After scraping an office, mark any previously-available golden slots
    that were NOT in this scrape as unavailable.
    still_available: set of (date_str, time_str) tuples
    """
    rows = (
        db.table("appointments")
        .select("id, appointment_date, appointment_time")
        .eq("office", office)
        .eq("slot_type", "golden")
        .eq("available", True)
        .execute()
    ).data

    for row in rows:
        key = (row["appointment_date"], row["appointment_time"])
        if key not in still_available:
            db.table("appointments").update({
                "available": False,
                "last_seen_at": now_utc(),
            }).eq("id", row["id"]).execute()


def mark_future_gone(db: Client, office: str) -> None:
    """Call when no future slots were found for an office — retire current closest."""
    db.table("appointments").update({
        "available": False,
        "is_current_closest": False,
    }).eq("office", office).eq("slot_type", "future").eq("is_current_closest", True).execute()


def mark_office_checked(db: Client, office: str) -> None:
    """Update last_checked_at on all rows for this office."""
    db.table("appointments").update({
        "last_checked_at": now_utc(),
    }).eq("office", office).execute()


def start_scrape_run(db: Client) -> str:
    """Insert a scrape_run row and return its ID."""
    result = db.table("scrape_runs").insert({"run_at": now_utc()}).execute()
    return result.data[0]["id"]


def finish_scrape_run(
    db: Client,
    run_id: str,
    offices_scraped: int,
    golden_found: int,
    future_found: int,
    errors: list,
) -> None:
    db.table("scrape_runs").update({
        "completed_at": now_utc(),
        "offices_scraped": offices_scraped,
        "golden_slots_found": golden_found,
        "future_slots_found": future_found,
        "errors": errors,
    }).eq("id", run_id).execute()


def get_active_subscribers(db: Client, office: str) -> list[str]:
    """Return emails of subscribers who want alerts for this office (or all offices)."""
    rows = (
        db.table("email_subscribers")
        .select("email, offices")
        .eq("active", True)
        .execute()
    ).data

    result = []
    for row in rows:
        offices = row.get("offices") or []
        if not offices or office in offices:
            result.append(row["email"])
    return result
