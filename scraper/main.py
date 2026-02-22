"""
Maine BMV Real ID Appointment Scraper
- Runs every 5 min via GitHub Actions cron
- Scrapes all 13 offices for Driver's License (Real ID) slots
- Selectors confirmed via probe on 2026-02-21
"""
import asyncio
import os
from datetime import date, datetime, timezone
from dotenv import load_dotenv
from playwright.async_api import async_playwright, Page

load_dotenv()

import db
import alerts

BMV_URL = "https://mainebmvappt.cxmflow.com/Appointment/Index/2c052fc7-571f-4b76-9790-7e91f103c408"
GOLDEN_THRESHOLD_DAYS = 8

# Exact office names as they appear on the BMV form ("{name} Appts")
OFFICES = [
    "Augusta",
    "Bangor",
    "Calais",
    "Caribou",
    "Ellsworth",
    "Kennebunk",
    "Lewiston",
    "Portland",
    "Rockland",
    "Rumford",
    "Scarborough",
    "Springvale",
    "Topsham",
]

DEBUG = os.environ.get("DEBUG", "false").lower() == "true"


def today() -> date:
    return datetime.now(timezone.utc).date()


def days_until(appt_date: date) -> int:
    return (appt_date - today()).days


def is_golden(appt_date: date) -> bool:
    return days_until(appt_date) < GOLDEN_THRESHOLD_DAYS


async def screenshot(page: Page, name: str) -> None:
    if DEBUG:
        path = f"debug_{name}.png"
        await page.screenshot(path=path, full_page=True)
        print(f"  [debug] {path}")


async def extract_slots(page: Page) -> list[dict]:
    """
    Extract all available slots from the Date & Time page.
    Uses data-datetime attribute on .ServiceAppointmentDateTime elements.
    Format: "4/22/2026 2:15:00 PM"
    """
    slot_elements = page.locator(".ServiceAppointmentDateTime[data-datetime]")
    count = await slot_elements.count()

    slots = []
    for i in range(count):
        el = slot_elements.nth(i)
        dt_str = await el.get_attribute("data-datetime")
        if not dt_str:
            continue
        try:
            # Parse "4/22/2026 2:15:00 PM"
            dt = datetime.strptime(dt_str.strip(), "%m/%d/%Y %I:%M:%S %p")
            slots.append({
                "date": dt.date(),
                "time": dt.strftime("%H:%M:%S"),
            })
        except ValueError as e:
            print(f"  [warn] parse error for '{dt_str}': {e}")

    return slots


async def scrape_office(office: str, db_client) -> dict:
    """
    Navigate BMV form for one office and return slot summary.

    Confirmed form flow (2026-02-21):
      1. goto BMV_URL → Welcome page
      2. Click .QflowObjectItem ("I Agree") → Location page (auto-advances)
      3. JS click .next-button → Service page (all office appts + service types)
      4. Click .QflowObjectItem "{office} Appts" → Appointment types for office
      5. Click .QflowObjectItem "Driver's License" → Date & Time page
      6. Read .ServiceAppointmentDateTime[data-datetime] for all slots
    """
    summary = {"office": office, "golden": 0, "future": 0, "new_golden": [], "error": None}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900}
        )
        page = await context.new_page()

        try:
            # ── Step 1: Welcome → Location ────────────────────────────────────
            await page.goto(BMV_URL, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(1500)
            await screenshot(page, f"{office}_1_welcome")

            agree = page.locator(".QflowObjectItem").first
            await agree.wait_for(timeout=10000)
            await agree.click()
            await page.wait_for_timeout(1500)
            await screenshot(page, f"{office}_2_location")

            # ── Step 2: Location → Service (JS click Next, no office selected) ─
            await page.evaluate("document.querySelector('.next-button').click()")
            await page.wait_for_timeout(1500)
            await screenshot(page, f"{office}_3_service")

            # ── Step 3: Service → Appointment Types ───────────────────────────
            office_item = page.locator(".QflowObjectItem").filter(has_text=f"{office} Appts")
            count = await office_item.count()
            if count == 0:
                summary["error"] = f"'{office} Appts' not found on service page"
                return summary

            await office_item.first.click()
            await page.wait_for_timeout(1500)
            await screenshot(page, f"{office}_4_appt_type")

            # ── Step 4: Select Driver's License ──────────────────────────────
            dl_item = page.locator(".QflowObjectItem").filter(has_text="Driver's License")
            dl_count = await dl_item.count()
            if dl_count == 0:
                summary["error"] = f"'Driver's License' not found for {office}"
                return summary

            await dl_item.first.click()
            await page.wait_for_timeout(2000)
            await screenshot(page, f"{office}_5_slots")

            # ── Step 5: Extract slots ─────────────────────────────────────────
            slots = await extract_slots(page)
            print(f"  Found {len(slots)} total slots for {office}")

            # ── Step 6: Process slots → DB ────────────────────────────────────
            still_available_golden: set[tuple] = set()
            future_dates: list[date] = []

            for slot in slots:
                appt_date = slot["date"]
                appt_time = slot["time"]

                if is_golden(appt_date):
                    still_available_golden.add((appt_date.isoformat(), appt_time))
                    is_new = db.upsert_golden_slot(db_client, office, appt_date, appt_time)
                    if is_new:
                        summary["new_golden"].append({"date": appt_date, "time": appt_time})
                    summary["golden"] += 1
                else:
                    future_dates.append(appt_date)
                    summary["future"] += 1

            db.mark_golden_gone(db_client, office, still_available_golden)

            if future_dates:
                closest = min(future_dates)
                db.upsert_future_slot(db_client, office, closest)
            else:
                db.mark_future_gone(db_client, office)

            db.mark_office_checked(db_client, office)

        except Exception as e:
            summary["error"] = f"Error scraping {office}: {e}"
            await screenshot(page, f"{office}_ERROR")
            print(f"  ERROR: {e}")
        finally:
            await browser.close()

    return summary


async def main():
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"\n{'='*60}\nMaine BMV Scraper — {now_str}\n{'='*60}")

    db_client = db.get_client()
    run_id = db.start_scrape_run(db_client)

    total_golden = 0
    total_future = 0
    errors = []

    for office in OFFICES:
        print(f"\n── {office} ──")
        summary = await scrape_office(office, db_client)

        total_golden += summary["golden"]
        total_future += summary["future"]

        if summary["error"]:
            errors.append({"office": office, "error": summary["error"]})
            print(f"  ERROR: {summary['error']}")
        else:
            print(f"  Golden: {summary['golden']} | Future: {summary['future']} "
                  f"| New alerts: {len(summary['new_golden'])}")

        # Send email alerts for new golden slots
        if summary["new_golden"]:
            subscribers = db.get_active_subscribers(db_client, office)
            for slot in summary["new_golden"]:
                alerts.send_golden_alert(
                    to_emails=subscribers,
                    office=office,
                    appt_date=slot["date"],
                    appt_time=slot["time"],
                    book_url=BMV_URL,
                )

        # Small pause between offices (polite scraping)
        await asyncio.sleep(2)

    db.finish_scrape_run(
        db_client,
        run_id=run_id,
        offices_scraped=len(OFFICES),
        golden_found=total_golden,
        future_found=total_future,
        errors=errors,
    )

    print(f"\n{'='*60}")
    print(f"Done. Golden: {total_golden} | Future: {total_future} | Errors: {len(errors)}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
