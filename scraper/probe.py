"""
Probe step 2: understand Date & Time DOM structure for slot extraction + pagination.
"""
import asyncio
from playwright.async_api import async_playwright

BMV_URL = "https://mainebmvappt.cxmflow.com/Appointment/Index/2c052fc7-571f-4b76-9790-7e91f103c408"
TEST_OFFICE = "Portland"


async def navigate_to_slots(page):
    """Navigate to the slot page for Portland, Driver's License."""
    print("→ Loading...")
    await page.goto(BMV_URL, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(1500)

    # Step 1: I Agree
    await page.locator(".QflowObjectItem").first.click()
    await page.wait_for_timeout(1500)

    # Step 2: JS Next → Service page
    await page.evaluate("document.querySelector('.next-button').click()")
    await page.wait_for_timeout(1500)

    # Step 3: Click Portland Appts
    await page.locator(".QflowObjectItem").filter(has_text=f"{TEST_OFFICE} Appts").first.click()
    await page.wait_for_timeout(1500)

    # Step 4: Click Driver's License
    dl = page.locator(".QflowObjectItem").filter(has_text="Driver's License")
    await dl.first.click()
    await page.wait_for_timeout(2000)
    print("→ On Date & Time page")


async def probe():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 900})

        await navigate_to_slots(page)
        await page.screenshot(path="slots_page.png", full_page=True)

        # ── Understand the DOM structure ─────────────────────────────────────
        html = await page.content()
        # Print relevant section (find the date/time area)
        # Look for common slot containers
        for selector in [
            ".date-section", ".time-slot", ".appointment-time",
            "td", "li", ".slot", "[class*='date']", "[class*='time']",
            ".QflowDateItem", ".QflowTimeItem", "dl", "dt", "dd",
            "div.date", "div.time", "table tr",
        ]:
            items = page.locator(selector)
            cnt = await items.count()
            if cnt > 0:
                sample = (await items.first.inner_text()).strip()[:60]
                print(f"  '{selector}': {cnt} items — first: '{sample}'")

        # Print full HTML of main content area
        print("\n--- INNER HTML of body (relevant section, 4000 chars) ---")
        # Find the "Date & Time" section specifically
        content = await page.locator("main, #maincontent, .content, body").first.inner_html()
        # Find approximate location of the date section
        idx = content.find("Apr")
        if idx == -1:
            idx = content.find("Mar")
        if idx > 100:
            print(content[max(0, idx-200):idx+3000])
        else:
            print(content[:4000])

        # ── Check for pagination ─────────────────────────────────────────────
        print("\n--- PAGINATION CHECK ---")
        next_btns = page.locator("button, a, input[type='submit']")
        cnt = await next_btns.count()
        for i in range(cnt):
            txt = (await next_btns.nth(i).inner_text()).strip()
            cls = await next_btns.nth(i).get_attribute("class") or ""
            vis = await next_btns.nth(i).is_visible()
            print(f"  [{i}] '{txt}' class='{cls}' visible={vis}")

        # ── Raw body text ────────────────────────────────────────────────────
        body = await page.inner_text("body")
        idx = body.find("Choose a Date")
        print(f"\n--- BODY TEXT (Date section) ---\n{body[idx:idx+2000]}")

        await browser.close()
        print("\n✓ See slots_page.png")


asyncio.run(probe())
