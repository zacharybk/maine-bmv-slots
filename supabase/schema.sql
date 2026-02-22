-- Maine BMV Appointment Tracker — Supabase Schema
-- Run this in the Supabase SQL Editor

-- ─────────────────────────────────────────────────────────────
-- APPOINTMENTS
-- Stores every slot we've ever seen. Two types:
--   'golden' → < 8 days away (specific time stored)
--   'future' → >= 8 days away (one "closest date" record per office)
-- ─────────────────────────────────────────────────────────────
create table if not exists appointments (
  id               uuid        default gen_random_uuid() primary key,
  office           text        not null,
  appointment_type text        not null default 'Driver''s License',
  appointment_date date        not null,
  appointment_time time,                  -- null for future slots
  slot_type        text        not null check (slot_type in ('golden', 'future')),
  is_golden        boolean     not null default false,
  is_current_closest boolean   not null default false,  -- future slots: is this office's active closest?
  available        boolean     not null default true,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_checked_at  timestamptz,
  replaced_at      timestamptz,           -- when a closer future date took over
  replaced_by_date date,                  -- the closer date that replaced it
  book_url         text        default 'https://mainebmvappt.cxmflow.com/Appointment/Index/2c052fc7-571f-4b76-9790-7e91f103c408',
  created_at       timestamptz not null default now()
);

-- Unique: one golden row per (office, date, time)
create unique index if not exists uq_golden_slot
  on appointments (office, appointment_date, appointment_time)
  where slot_type = 'golden';

-- Unique: one active "current closest" per office
create unique index if not exists uq_current_closest
  on appointments (office)
  where slot_type = 'future' and is_current_closest = true;

-- General indexes
create index if not exists idx_appt_office   on appointments (office);
create index if not exists idx_appt_available on appointments (available);
create index if not exists idx_appt_golden   on appointments (is_golden, available);
create index if not exists idx_appt_date     on appointments (appointment_date);


-- ─────────────────────────────────────────────────────────────
-- SCRAPE RUNS
-- One row per scrape execution for audit / "last checked" display
-- ─────────────────────────────────────────────────────────────
create table if not exists scrape_runs (
  id                uuid        default gen_random_uuid() primary key,
  run_at            timestamptz not null default now(),
  completed_at      timestamptz,
  offices_scraped   int         default 0,
  golden_slots_found int        default 0,
  future_slots_found int        default 0,
  errors            jsonb       default '[]'::jsonb
);


-- ─────────────────────────────────────────────────────────────
-- EMAIL SUBSCRIBERS
-- ─────────────────────────────────────────────────────────────
create table if not exists email_subscribers (
  id             uuid        default gen_random_uuid() primary key,
  email          text        unique not null,
  subscribed_at  timestamptz not null default now(),
  offices        text[]      default array[]::text[],  -- empty = all offices
  active         boolean     not null default true
);


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Public: read appointments + scrape_runs, insert subscribers
-- Service role: full write access (used by scraper)
-- ─────────────────────────────────────────────────────────────
alter table appointments      enable row level security;
alter table scrape_runs       enable row level security;
alter table email_subscribers enable row level security;

-- Anyone can read appointments and scrape_runs
create policy "public_read_appointments"
  on appointments for select to anon, authenticated using (true);

create policy "public_read_scrape_runs"
  on scrape_runs for select to anon, authenticated using (true);

-- Anyone can subscribe (insert their email)
create policy "public_subscribe"
  on email_subscribers for insert to anon, authenticated with check (true);

-- Service role writes everything (scraper uses SUPABASE_SERVICE_KEY)
create policy "service_insert_appointments"
  on appointments for insert to service_role with check (true);

create policy "service_update_appointments"
  on appointments for update to service_role using (true);

create policy "service_insert_scrape_runs"
  on scrape_runs for insert to service_role with check (true);

create policy "service_update_scrape_runs"
  on scrape_runs for update to service_role using (true);

create policy "service_read_subscribers"
  on email_subscribers for select to service_role using (true);

create policy "service_update_subscribers"
  on email_subscribers for update to service_role using (true);


-- ─────────────────────────────────────────────────────────────
-- REALTIME
-- Frontend subscribes to live updates without polling
-- ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table appointments;
alter publication supabase_realtime add table scrape_runs;
