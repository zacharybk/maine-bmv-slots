# Telegram Bot Notifications — Maine BMV

## Context

Email alert code exists in `alerts.py` but was never fully wired up or working. This plan builds Telegram as the first real notification channel: free, no spam filters, fully opt-in, easy to unsubscribe. The email code stays in `alerts.py` but the frontend form is hidden (not deleted).

---

## Architecture

- **Bot command handling**: Vercel API route at `app/api/telegram/route.ts`  
  Telegram pushes updates here via webhook. Handles `/start` flow, office toggling (inline keyboard), `/stop`, `/status`.  
  Uses `SUPABASE_SERVICE_KEY` (server-side only — never in a NEXT_PUBLIC_ var).  
  **Security**: Two layers — (1) `TELEGRAM_WEBHOOK_SECRET` verified on every incoming POST; anything without the right header gets a 401. (2) Service key stays server-side. No meaningful attack surface.

- **Alert sending**: Python scraper fires alerts per office inside the scrape loop (`scraper/alerts.py`).  
  Augusta is scraped → Augusta alert sent → Bangor starts. Alert goes out within ~30 seconds of the scraper starting, not after all 13 offices. The detection latency is the 10-minute scrape interval, not the full run time.

- **State**: New `telegram_subscribers` + `telegram_alert_log` tables in Supabase.  
  Scraper completion is tracked in `scrape_runs` table (already exists) — that's what powers "last checked" on the frontend.

---

## Decisions Made

- Email: keep code, hide `EmailSignup.tsx` from the page (don't render it)
- First name + optional email collected during `/start` flow
- Alerts fire per office as scraped — one message per office per scrape cycle. If an office has multiple new slots in one scrape, they're batched into a single message for that office. No cross-office batching (someone 6 hours from Caribou doesn't want it mixed with Portland).
- Office keyboard uses **regional grouping** (see keyboard layout below). Tapping a region name toggles all offices in that region. Tapping individual offices works as before.
- Donation link included in the 2nd alert sent to each subscriber (`alerts_sent_count == 2`)
- Feedback + donation ask on `/stop`: bot sends a message with a soft donation ask + quick-reply buttons for exit reason (stored as `stopped_reason` in DB)
- 1:1 broadcast: possible anytime via admin script — query Supabase for chat IDs, POST to Telegram `sendMessage`. Any subscriber who ever started the bot can be messaged.
- Alert log table: implemented, used for deduplication + analytics + donation timing
- Office re-selection: `/start` re-runs setup anytime
- Frontend CTA: "Get real-time alerts" headline, Telegram as primary channel, with a "Don't have Telegram?" fallback that collects name/email/preferred channel (market research)
- Vercel Analytics: add `@vercel/analytics`

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `supabase/schema.sql` | Append two new tables + RLS + trigger |
| `app/api/telegram/route.ts` | **New** — Telegram webhook handler |
| `components/AlertSignup.tsx` | **New** — replaces EmailSignup; Telegram primary + "no Telegram" fallback form |
| `scraper/alerts.py` | Add `send_telegram_alerts()` (batched, with log + donation logic) |
| `scraper/db.py` | Add `get_telegram_subscribers()` + `log_telegram_alert()` |
| `scraper/main.py` | Call Telegram alerts after email alerts (lines 217–227); pass full slot list per office |
| `scraper/requirements.txt` | Add `httpx==0.27.0` |
| `render.yaml` | Add `TELEGRAM_BOT_TOKEN` env var entry |
| `app/page.tsx` | Import + render `<AlertSignup />` between GoldenSlots and AllAppointments; add Vercel Analytics |
| `package.json` | Add `@vercel/analytics` |

---

## Step 1 — Supabase: New Tables

Append to `supabase/schema.sql` (also run in Supabase SQL Editor):

```sql
-- ── Telegram subscribers ──────────────────────────────────────────────────
create table if not exists telegram_subscribers (
  id                 uuid        default gen_random_uuid() primary key,
  chat_id            bigint      unique not null,
  offices            text[]      not null default array[]::text[],  -- empty = all offices
  active             boolean     not null default true,
  pending_setup      boolean     not null default false,
  setup_step         text,       -- 'awaiting_name' | 'awaiting_email' | 'selecting_offices' | null
  first_name         text,
  email              text,       -- optional, collected at end of setup
  username           text,       -- Telegram @username, nullable, for debugging
  alerts_sent_count  integer     not null default 0,
  stopped_reason     text,       -- 'found_slot' | 'no_luck' | 'too_many' | null
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_tg_active  on telegram_subscribers (active);
create index if not exists idx_tg_chat_id on telegram_subscribers (chat_id);

alter table telegram_subscribers enable row level security;

create policy "anon_insert_telegram"    on telegram_subscribers for insert to anon, authenticated with check (true);
create policy "anon_update_telegram"    on telegram_subscribers for update to anon, authenticated using (true);
create policy "service_read_telegram"   on telegram_subscribers for select to service_role using (true);
create policy "service_update_telegram" on telegram_subscribers for update to service_role using (true);

-- ── Alert log ─────────────────────────────────────────────────────────────
-- One row per alert sent. Used for deduplication, analytics, and donation timing.
create table if not exists telegram_alert_log (
  id          uuid        default gen_random_uuid() primary key,
  chat_id     bigint      not null references telegram_subscribers(chat_id),
  office      text        not null,
  slot_date   date        not null,
  slot_time   text        not null,
  sent_at     timestamptz not null default now()
);

create index if not exists idx_alert_log_chat_id on telegram_alert_log (chat_id);
create index if not exists idx_alert_log_slot    on telegram_alert_log (office, slot_date, slot_time);

alter table telegram_alert_log enable row level security;
create policy "service_all_alert_log" on telegram_alert_log for all to service_role using (true);

-- ── updated_at trigger ────────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger tg_subscribers_updated_at
  before update on telegram_subscribers
  for each row execute function update_updated_at();
```

---

## Step 2 — Vercel Webhook Handler

New file: `app/api/telegram/route.ts`

### `/start` conversation flow (step-by-step)

```
Step 1 — /start received
  → upsert(chat_id, active=false, pending_setup=true, setup_step='awaiting_name', offices=[])
  → sendMessage: "Welcome to Maine BMV Slot Alerts! I'll text you the moment a short-notice slot opens.\n\nFirst, what's your first name?"

Step 2 — User replies with their name (plain text while setup_step='awaiting_name')
  → save first_name, set setup_step='selecting_offices'
  → sendMessage: "Nice to meet you, {name}! Now pick the offices you want alerts for — tap to check, tap again to uncheck. Leave all unchecked for all offices."
  → sendMessage with office keyboard (all unchecked)

Step 3 — User toggles offices (callback_query "toggle:X" or "toggle_all")
  → answerCallbackQuery
  → update offices[] in DB
  → editMessageReplyMarkup (keyboard updates in-place, no new message)

Step 4 — User taps "Done ✓" (callback_query "confirm")
  → set active=true, pending_setup=false, setup_step='awaiting_email'
  → editMessageText: "You're all set, {name}! Watching: {office list or 'all offices'}.\n\nOne more thing — want to leave an email as backup? Reply with it or just say 'skip'."
  → (wait for email reply)

Step 5 — User replies with email or 'skip' (plain text while setup_step='awaiting_email')
  → if not 'skip': save email
  → set setup_step=null
  → sendMessage: "Done! I'll message you when a slot opens. To change offices anytime, send /start again."

/stop command OR callback_query "stop"
  → set active=false
  → sendMessage: "You've been unsubscribed. Did you find a slot? If this helped, consider buying me a coffee ☕ [link]"
  → follow-up inline keyboard with exit reason buttons:
    ["Found a slot ✓"]              callback_data="stopped:found_slot"
    ["Didn't find anything useful"] callback_data="stopped:no_luck"
    ["Too many messages"]           callback_data="stopped:too_many"
  → tapping one stores stopped_reason in telegram_subscribers, sends brief "Thanks for the feedback!"

/status command
  → reply with: active state, subscribed offices (or "all"), first_name if set

Any other plain text while setup_step is null
  → "Use /start to subscribe, /stop to unsubscribe, or /status to check your subscription."
```

### Keyboard layout (built from DB `offices[]` state)

Offices grouped by region. Region buttons toggle all offices in that region (tap once = check all, tap again = uncheck all). Individual office buttons toggle as before.

```
[── Southern Maine ──]        callback_data="region:southern"
[✅ Kennebunk]  [Portland]
[Scarborough]   [Springvale]

[── Midcoast ──]              callback_data="region:midcoast"
[Rockland]  [Topsham]

[── Central & Western ──]     callback_data="region:central"
[Augusta]  [Lewiston]
[Rumford]

[── Downeast ──]              callback_data="region:downeast"
[Calais]  [Ellsworth]

[── Bangor & Aroostook ──]    callback_data="region:aroostook"
[Bangor]  [Caribou]

[All Offices]                 callback_data="toggle_all"
[Done ✓]                      callback_data="confirm"
```

Region labels show a checkmark prefix if all offices in that region are selected:  
`✅ Southern Maine` vs `Southern Maine`.  
Selected individual offices: `✅ Portland` vs `Portland`.

Region groupings:
```python
OFFICE_REGIONS = {
    "southern":  ["Kennebunk", "Portland", "Scarborough", "Springvale"],
    "midcoast":  ["Rockland", "Topsham"],
    "central":   ["Augusta", "Lewiston", "Rumford"],
    "downeast":  ["Calais", "Ellsworth"],
    "aroostook": ["Bangor", "Caribou"],
}
REGION_LABELS = {
    "southern":  "Southern Maine",
    "midcoast":  "Midcoast",
    "central":   "Central & Western",
    "downeast":  "Downeast",
    "aroostook": "Bangor & Aroostook",
}
```

### Office names (exact from `scraper/main.py`)
```
Augusta, Bangor, Calais, Caribou, Ellsworth, Kennebunk, Lewiston,
Portland, Rockland, Rumford, Scarborough, Springvale, Topsham
```

### Security
- Verify `X-Telegram-Bot-Api-Secret-Token` header on every POST before any DB operation.
- `SUPABASE_SERVICE_KEY` is a server-side-only env var (no `NEXT_PUBLIC_` prefix).

---

## Step 3 — Python Scraper Changes

### `scraper/db.py` — append two functions

```python
def get_telegram_subscribers(db: Client, office: str) -> list[dict]:
    """Returns {chat_id, first_name, alerts_sent_count} for active subscribers watching this office."""
    rows = (
        db.table("telegram_subscribers")
        .select("chat_id, offices, first_name, alerts_sent_count")
        .eq("active", True)
        .execute()
    ).data
    return [
        {
            "chat_id": row["chat_id"],
            "first_name": row.get("first_name"),
            "alerts_sent_count": row.get("alerts_sent_count", 0),
        }
        for row in rows
        if not row.get("offices") or office in row["offices"]
    ]


def log_telegram_alert(db: Client, chat_id: int, office: str, slot_date, slot_time: str) -> None:
    """Record a sent alert and increment the subscriber's alert count."""
    db.table("telegram_alert_log").insert({
        "chat_id": chat_id,
        "office": office,
        "slot_date": str(slot_date),
        "slot_time": slot_time,
    }).execute()
    db.table("telegram_subscribers").update(
        {"alerts_sent_count": db.rpc("increment_alerts_sent", {"p_chat_id": chat_id}).execute()}
    )
    # Simpler: use Postgres function or just do a raw increment:
    db.rpc("increment_alerts_sent_count", {"p_chat_id": chat_id}).execute()


# Also add this Postgres function to schema.sql:
# create or replace function increment_alerts_sent_count(p_chat_id bigint)
# returns void language sql as $$
#   update telegram_subscribers set alerts_sent_count = alerts_sent_count + 1 where chat_id = p_chat_id;
# $$;
```

### `scraper/alerts.py` — append

Key changes from original plan:
- Receives all new slots for an office as a batch (not one per call)
- Formats multiple slots into a single message
- Checks `alerts_sent_count` to decide whether to include donation link (count == 2 after increment)
- Calls `db.log_telegram_alert()` after successful send

```python
import httpx
from datetime import datetime

TELEGRAM_API_BASE = f"https://api.telegram.org/bot{os.environ.get('TELEGRAM_BOT_TOKEN', '')}"
BUYMEACOFFEE_URL = "https://buymeacoffee.com/zacharybk"


def _format_slot(appt_date, appt_time: str) -> str:
    """Format date + time as '2:15 PM on May 15'."""
    try:
        t = datetime.strptime(appt_time[:5], "%H:%M")
        time_str = t.strftime("%-I:%M %p")
    except Exception:
        time_str = appt_time
    try:
        d = datetime.strptime(str(appt_date), "%Y-%m-%d")
        date_str = d.strftime("%B %-d")
    except Exception:
        date_str = str(appt_date)
    return f"{time_str} on {date_str}"


def send_telegram_alerts(
    db_client,
    subscribers: list[dict],
    office: str,
    new_slots: list[dict],  # list of {date, time}
    book_url: str,
) -> None:
    """
    Send one batched Telegram message per subscriber for all new slots at this office.
    Logs each send. Includes donation CTA on the subscriber's 2nd alert.
    """
    if not subscribers or not new_slots or not os.environ.get("TELEGRAM_BOT_TOKEN"):
        return

    for sub in subscribers:
        chat_id = sub["chat_id"]
        name = sub.get("first_name")
        count_before = sub.get("alerts_sent_count", 0)

        # Build slot lines
        if len(new_slots) == 1:
            slot_str = _format_slot(new_slots[0]["date"], new_slots[0]["time"])
            greeting = f"Hey {name}, new" if name else "New"
            body = f"⚡ <b>{greeting} slot in {office}</b> at {slot_str}"
        else:
            greeting = f"Hey {name}, new slots" if name else "New slots"
            lines = "\n".join(
                f"• {office} at {_format_slot(s['date'], s['time'])}"
                for s in new_slots
            )
            body = f"⚡ <b>{greeting}</b>\n{lines}"

        # Donation CTA on the subscriber's 2nd alert
        footer = ""
        if count_before == 1:  # this send will make it 2
            footer = f"\n\n<a href='{BUYMEACOFFEE_URL}'>☕ Buy me a coffee if this helped!</a>"

        text = f"{body}\n\nSlots go fast.{footer}"

        reply_markup = {"inline_keyboard": [
            [{"text": "Book This Slot →", "url": book_url}],
            [{"text": "Stop alerts", "callback_data": "stop"}],
        ]}

        try:
            resp = httpx.post(f"{TELEGRAM_API_BASE}/sendMessage", json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "reply_markup": reply_markup,
                "disable_web_page_preview": True,
            }, timeout=10)
            if resp.is_success:
                # Log each slot separately for dedup/analytics granularity
                for slot in new_slots:
                    db.log_telegram_alert(db_client, chat_id, office, slot["date"], slot["time"])
        except Exception as e:
            print(f"Telegram alert failed for {chat_id}: {e}")
```

### `scraper/main.py` — lines 217–227

```python
if summary["new_golden"]:
    email_subs    = db.get_active_subscribers(db_client, office)
    telegram_subs = db.get_telegram_subscribers(db_client, office)
    for slot in summary["new_golden"]:
        alerts.send_golden_alert(
            to_emails=email_subs, office=office,
            appt_date=slot["date"], appt_time=slot["time"], book_url=BMV_URL,
        )
    # Send one batched Telegram message per subscriber for all new slots at this office
    alerts.send_telegram_alerts(
        db_client=db_client,
        subscribers=telegram_subs,
        office=office,
        new_slots=summary["new_golden"],
        book_url=BMV_URL,
    )
```

### `scraper/requirements.txt`

Add: `httpx==0.27.0`

---

## Step 4 — Frontend

### New `components/AlertSignup.tsx`

Three states, rendered in sequence:
1. **Default**: "Get real-time alerts" headline + "Sign up with Telegram" button (Telegram blue, `t.me/BotUsername`)
2. **"Don't have Telegram?" link below button**: clicking reveals a small form
3. **Fallback form**: Name, email, "How do you want to receive alerts?" (radio: SMS / WhatsApp / Email / Other). Submitted rows go to a new `notification_interest` Supabase table. Pure market research — no alerts sent.

```tsx
// components/AlertSignup.tsx
"use client";
import { useState } from "react";

export default function AlertSignup() {
  const [showFallback, setShowFallback] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "MaineBMVAlertsBot";

  // fallback form state
  const [form, setForm] = useState({ name: "", email: "", channel: "" });

  async function handleFallbackSubmit(e: React.FormEvent) {
    e.preventDefault();
    // insert to notification_interest table via supabase anon client
    // ...
    setSubmitted(true);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3">
        <div className="font-semibold text-gray-900 text-sm">Get real-time alerts</div>
        <div className="text-xs text-gray-500 mt-0.5">
          Get a message the moment a short-notice slot opens. Choose which offices to watch.
        </div>
      </div>

      <a
        href={`https://t.me/${BOT_USERNAME}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#229ED9] text-white text-sm font-semibold hover:bg-[#1a8bbf] transition-colors"
      >
        {/* Telegram SVG icon */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.771l-2.97-.924c-.645-.204-.657-.645.135-.953l11.57-4.462c.537-.194 1.006.131.836.789h.153z"/>
        </svg>
        Sign up with Telegram
      </a>

      {!showFallback && !submitted && (
        <button
          onClick={() => setShowFallback(true)}
          className="block mt-2 text-xs text-gray-400 hover:text-gray-600 underline"
        >
          I don't have Telegram
        </button>
      )}

      {showFallback && !submitted && (
        <form onSubmit={handleFallbackSubmit} className="mt-3 space-y-2">
          <input
            type="text"
            placeholder="First name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm"
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm"
            required
          />
          <div className="text-xs text-gray-500 font-medium">How do you want to receive alerts?</div>
          {["SMS", "WhatsApp", "Email", "Other"].map(ch => (
            <label key={ch} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="channel"
                value={ch}
                checked={form.channel === ch}
                onChange={() => setForm(f => ({ ...f, channel: ch }))}
                required
              />
              {ch}
            </label>
          ))}
          <button type="submit" className="px-4 py-1.5 rounded bg-gray-800 text-white text-sm font-medium hover:bg-gray-700">
            Submit
          </button>
        </form>
      )}

      {submitted && (
        <p className="mt-2 text-xs text-gray-500">Got it — we'll keep this in mind for future channels.</p>
      )}
    </div>
  );
}
```

Also needs: a `notification_interest` table in Supabase (name, email, channel, created_at — anon INSERT allowed).

### `app/page.tsx`

```tsx
import AlertSignup from "@/components/AlertSignup";
import { Analytics } from "@vercel/analytics/react";
// ...
<GoldenSlots />
<div className="mb-8"><AlertSignup /></div>
<div className="mb-6">...AppointmentsTable...</div>
// at bottom of <main>:
<Analytics />
```

`EmailSignup.tsx` stays in `components/` but is NOT imported or rendered anywhere.

---

## Step 5 — Environment Variables

### Vercel (add all)
| Var | Value |
|-----|-------|
| `TELEGRAM_BOT_TOKEN` | from BotFather — server-side only, no NEXT_PUBLIC_ |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 16` |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | e.g. `MaineBMVSlotsBot` (no @) |
| `SUPABASE_SERVICE_KEY` | already on Render; add to Vercel for the webhook route |

### Render dashboard
- `TELEGRAM_BOT_TOKEN`

### `render.yaml` addition
```yaml
- key: TELEGRAM_BOT_TOKEN
  sync: false
```

---

## Step 6 — One-Time Manual Setup (Zach runs these once)

These are developer setup steps, not end-user instructions.

1. **Create bot** via `@BotFather` → `/newbot` → copy the token
2. **Set commands** via `/setcommands`:
   ```
   start - Subscribe to slot alerts
   stop - Unsubscribe
   status - Check your subscription
   ```
3. **Add all env vars** to Vercel + Render dashboards
4. **Deploy to Vercel**
5. **Register webhook** (one curl after deploy):
   ```bash
   curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
     -H "Content-Type: application/json" \
     -d "{\"url\": \"https://your-app.vercel.app/api/telegram\",
          \"secret_token\": \"${WEBHOOK_SECRET}\",
          \"allowed_updates\": [\"message\", \"callback_query\"]}"
   ```
   Expected: `{"ok":true,"result":true}`
6. **Run Supabase migration** — paste new SQL into Supabase SQL Editor

---

## Step 7 — Verification

1. Open `t.me/YourBot` → `/start` → answer name prompt → see office keyboard
2. Tap offices to toggle → checkmarks appear/disappear in-place
3. Tap "Done ✓" → email prompt → `skip` → confirmation message
4. Check Supabase: `select * from telegram_subscribers` → row with `active=true`, `first_name` set
5. Send `/status` → echoes offices
6. Send `/stop` → confirm unsubscribed
7. Test alert locally (remove before deploy):
   ```python
   alerts.send_telegram_alerts(
       db_client=db_client,
       subscribers=[{"chat_id": YOUR_CHAT_ID, "first_name": "Zach", "alerts_sent_count": 0}],
       office="Augusta",
       new_slots=[{"date": date.today(), "time": "14:00"}],
       book_url=BMV_URL,
   )
   ```
8. Send a second test alert → confirm buymeacoffee link appears
9. Check `telegram_alert_log`: `select * from telegram_alert_log` → rows logged
10. Webhook health: `curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"` → `pending_update_count: 0`, no error

---

## Additional Supabase Table (for fallback form)

```sql
create table if not exists notification_interest (
  id         uuid        default gen_random_uuid() primary key,
  name       text        not null,
  email      text        not null,
  channel    text        not null,
  created_at timestamptz not null default now()
);
alter table notification_interest enable row level security;
create policy "anon_insert_interest" on notification_interest for insert to anon, authenticated with check (true);
```
