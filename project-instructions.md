# Maine BMV Real ID Appointment Tracker

## Project Goal
Scrape all 13 Maine BMV offices every 5 minutes for Driver's License (Real ID) appointment availability.
Display results on a live-updating public website. Alert subscribers by email when rare "golden" slots appear.

---

## Live URLs (to fill in after deploy)
- Website: `mainebmv.vercel.app` (or custom domain later)
- Supabase project: TBD
- Render scraper: TBD

---

## The Core Logic

### Two types of appointments

**Golden Slots** — `< 8 days from today`
- Log every individual time slot (e.g. Feb 13 at 2:00 PM, Feb 13 at 2:15 PM)
- Each is a separate row in the DB
- Pin to top of table, highlighted visually
- Display: office, date (written out), time (specific)
- When no longer available: mark `available = false`, move out of pinned section
- Show "Book Now" CTA while available
- Keep in history as "Gone" — proves value to future users

**Future Slots** — `>= 8 days from today`
- Per office, track only the **closest upcoming date**
- One active "current closest" record per office at any time
- Display: office, date only (no time), "Many" in time column
- When a closer date appears: set old record `is_current_closest = false`, insert new record
- When the closest date disappears (booked): mark `available = false`, let next run create new record for the new closest date
- No duplicate date spam — don't log April 14 at 10:15, 10:30, 10:45 separately

---

## Target Offices
All at URL: https://mainebmvappt.cxmflow.com/Appointment/Index/2c052fc7-571f-4b76-9790-7e91f103c408

1. Augusta — 19 Anthony Avenue
2. Bangor — 396 Griffin Road Suite 202
3. Calais — 23 Washington Street Suite 2
4. Caribou — 14 Access Highway Suite 2
5. Ellsworth — 22 School Street
6. Kennebunk — 63 Portland Road
7. Lewiston — 36 Mollison Way Suite 1
8. Portland — 125 Presumpscot Street
9. Rockland — 360 Old County Road Suite 1
10. Rumford — 65 Lincoln Avenue
11. Scarborough — 200 Expedition Drive Suite G
12. Springvale — 456 Main Street
13. Topsham — 125B Main Street

Appointment type filter: **Driver's License (including Real ID)**

---

## Database Schema (Supabase / PostgreSQL)

### `appointments`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | auto |
| office | text | e.g. "Rockland" |
| appointment_type | text | always "Driver's License" |
| appointment_date | date | |
| appointment_time | time | null for future slots |
| slot_type | text | 'golden' or 'future' |
| is_golden | boolean | true if < 8 days when first seen |
| is_current_closest | boolean | for future slots only: is this office's current closest date? |
| available | boolean | currently showing as open |
| first_seen_at | timestamptz | when we first found this |
| last_seen_at | timestamptz | last time scraper confirmed it existed |
| last_checked_at | timestamptz | last time scraper ran for this office |
| replaced_at | timestamptz | for future slots: when a closer date took over |
| replaced_by_date | date | the closer date that replaced it |
| book_url | text | https://mainebmvappt.cxmflow.com/Appointment/Index/2c052fc7-571f-4b76-9790-7e91f103c408 |

**Index on:** `(office, appointment_date, appointment_time, slot_type)` — prevents duplicates

### `scrape_runs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | auto |
| run_at | timestamptz | when scrape started |
| completed_at | timestamptz | when scrape finished |
| offices_scraped | int | |
| golden_slots_found | int | |
| future_slots_found | int | |
| errors | text | JSON array of any errors |

### `email_subscribers`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | text unique | |
| subscribed_at | timestamptz | |
| offices | text[] | offices they care about, empty = all |
| active | boolean | |

---

## Scraper Logic (Python + Playwright)

### File: `scraper/main.py`

```
Flow per scrape run:
1. Open BMV site
2. Click "I Agree"
3. For each of 13 offices:
   a. Select office (click the office link in the form)
   b. Select "Driver's License (including Real ID)"
   c. Wait for calendar/slot list to load
   d. Collect ALL available time slots
   e. Categorize each:
      - If date < today + 8 days → golden slot
      - If date >= today + 8 days → find closest date → future slot
   f. For golden slots: upsert each time slot row
   g. For future slots: find earliest available date, upsert one record
   h. Mark any previously-available slots that are now gone as available=false
4. Write scrape_run record to DB
5. Send email alerts for any NEW golden slots
```

### Deduplication logic
- Golden: unique on `(office, appointment_date, appointment_time)` — if exists and still available, just update `last_seen_at`
- Future: unique on `(office, is_current_closest=true)` — if new closest date is earlier than existing, flip the old one and insert new

### Handling disappeared slots
- After scraping an office, compare what was `available=true` in DB vs what scraper found
- Any row in DB that's `available=true` but NOT in current scrape results → set `available=false`

---

## Frontend (Next.js on Vercel)

### Stack
- Next.js 14 (App Router)
- Supabase JS client (real-time subscriptions)
- Tailwind CSS
- No auth needed for read-only view

### Page: `/` (main dashboard)

**Header:**
- Site name / tagline
- Last checked: `February 21, 2026 at 3:45 PM` (from latest `scrape_runs.completed_at`)

**Golden Slots section (pinned top)**
- Highlighted card/row — visually distinct (amber/green bg)
- Shows: Office | Type | Date (written out) | Time (specific) | Book Now button
- Sorted by date ASC, then time ASC
- Only shows `available = true` AND `slot_type = 'golden'`

**All Appointments table**
- Filters:
  - Office (multi-select dropdown, default = all)
  - Available (Y/N toggle, default = Y)
  - Per-page: 25 / 50 / 100
- Columns: Office | Date | Time | First Seen | Available | Book Now
- For future slots: Time column shows "Many"
- Pagination at 25 default
- Sort: available DESC, is_golden DESC, appointment_date ASC
- Real-time: Supabase subscription updates table without refresh

**Design inspiration:** Clean table like the Dribbble eBook Orders example — simple borders, minimal color, highlight row for golden slots

### Email Signup
- Simple form: email input + "Alert me for golden slots"
- Optional: office filter
- Writes to `email_subscribers` table
- No auth needed — just email

---

## Alerts

### Email (Resend.com — free tier = 3,000/month)
- Trigger: scraper finds a NEW golden slot (first_seen = now, available = true)
- Send to all active subscribers (filtered by office preference)
- Subject: `⚡ Rockland — Feb 24 at 10:30 AM — Book Now`
- Body: simple, direct link to Book Now

### X.com (Phase 2 — skip for now)
- Post when new golden slot appears
- Format: "New Real ID slot just opened in Rockland, ME — Feb 24 at 10:30 AM. Book: [link] #MaineRealID"

---

## Deployment

### Scraper host: Render (free tier)
- Python + Playwright Docker container
- Cron job: every 5 minutes
- Env vars: SUPABASE_URL, SUPABASE_KEY, RESEND_API_KEY

### Frontend: Vercel (free tier)
- `vercel deploy` from Next.js root
- Env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

### Database: Supabase (free tier)
- 500MB storage (more than enough)
- Real-time enabled on `appointments` table
- Row-level security: read-only public, write only via service key

---

## Build Phases

### Phase 1 — Scraper (do first, validate data)
- [ ] Set up Python project with Playwright
- [ ] Manually map the BMV form flow (step IDs, selectors)
- [ ] Build scraper for 1 office, confirm data extraction
- [ ] Scale to all 13 offices
- [ ] Connect to Supabase, write data
- [ ] Add deduplication + availability tracking
- [ ] Deploy to Render with 5-min cron

### Phase 2 — Frontend
- [ ] Set up Next.js project
- [ ] Connect to Supabase
- [ ] Build golden slots section
- [ ] Build main appointments table with filters
- [ ] Add real-time subscriptions
- [ ] Add email signup form
- [ ] Deploy to Vercel

### Phase 3 — Alerts
- [ ] Set up Resend account + API key
- [ ] Wire scraper to send emails on new golden slots
- [ ] Test end-to-end

### Phase 4 — Polish & Monetize
- [ ] Custom domain
- [ ] SMS tier via Twilio (paid users)
- [ ] X.com auto-posting

---

## Open Questions / Decisions Made
- Playwright over Selenium: better async, handles AJAX forms, less flaky
- Every 5 min scrape: user requested, fine on Render free tier
- Vercel + Supabase: free, real-time capable, Supabase auth ready for paid tiers
- Resend for email: 3k/month free, simple API
- Booking URL: same for all offices (user navigates from there)
- No user accounts for MVP — just email signup
