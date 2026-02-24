"""
Persistent background worker for the Maine BMV scraper.
Runs on Render as a long-lived process — no cold starts between scrapes.
Loops every SCRAPE_INTERVAL seconds (default 600 = 10 minutes).
"""
import asyncio
import os
from datetime import datetime, timezone

SCRAPE_INTERVAL = int(os.environ.get("SCRAPE_INTERVAL", "600"))


async def run_loop():
    from main import main

    print(f"Maine BMV scraper started — interval: {SCRAPE_INTERVAL // 60} min", flush=True)

    run_count = 0
    while True:
        run_count += 1
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        print(f"\n{'='*50}\n[Run #{run_count}] {now}\n{'='*50}", flush=True)

        try:
            await main()
        except Exception as e:
            print(f"[Run #{run_count} ERROR] {e}", flush=True)

        next_run = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        print(f"[Sleeping {SCRAPE_INTERVAL}s — next run after {next_run}]", flush=True)
        await asyncio.sleep(SCRAPE_INTERVAL)


if __name__ == "__main__":
    asyncio.run(run_loop())
