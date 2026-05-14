import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const BUYMEACOFFEE_URL = "https://buymeacoffee.com/zacharybk";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Office / region data ───────────────────────────────────────────────────

const OFFICE_REGIONS: Record<string, string[]> = {
  southern:  ["Kennebunk", "Portland", "Scarborough", "Springvale"],
  midcoast:  ["Rockland", "Topsham"],
  central:   ["Augusta", "Lewiston", "Rumford"],
  downeast:  ["Calais", "Ellsworth"],
  aroostook: ["Bangor", "Caribou"],
};

const REGION_LABELS: Record<string, string> = {
  southern:  "Southern Maine",
  midcoast:  "Midcoast",
  central:   "Central & Western",
  downeast:  "Downeast",
  aroostook: "Bangor & Aroostook",
};

const ALL_OFFICES = Object.values(OFFICE_REGIONS).flat();

// ── Telegram API helpers ───────────────────────────────────────────────────

async function tg(method: string, body: object) {
  return fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendMessage(chatId: number, text: string, extra?: object) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

async function editMessageText(chatId: number, messageId: number, text: string, extra?: object) {
  return tg("editMessageText", {
    chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...extra,
  });
}

async function editMessageReplyMarkup(chatId: number, messageId: number, replyMarkup: object) {
  return tg("editMessageReplyMarkup", {
    chat_id: chatId, message_id: messageId, reply_markup: replyMarkup,
  });
}

async function answerCallbackQuery(id: string, text?: string) {
  return tg("answerCallbackQuery", { callback_query_id: id, text: text ?? "" });
}

// ── Keyboard builder ───────────────────────────────────────────────────────

function buildKeyboard(selectedOffices: string[]) {
  const sel = new Set(selectedOffices);
  const rows: object[][] = [];

  for (const [regionKey, offices] of Object.entries(OFFICE_REGIONS)) {
    const allInRegion = offices.every((o) => sel.has(o));
    const label = allInRegion
      ? `✅ ${REGION_LABELS[regionKey]}`
      : REGION_LABELS[regionKey];

    // Region header button (toggles all in region)
    rows.push([{ text: label, callback_data: `region:${regionKey}` }]);

    // Office buttons in pairs
    for (let i = 0; i < offices.length; i += 2) {
      const pair = offices.slice(i, i + 2).map((o) => ({
        text: sel.has(o) ? `✅ ${o}` : o,
        callback_data: `toggle:${o}`,
      }));
      rows.push(pair);
    }
  }

  rows.push([{ text: "Done ✓", callback_data: "confirm" }]);

  return { inline_keyboard: rows };
}

// ── DB helpers ─────────────────────────────────────────────────────────────

async function getSubscriber(chatId: number) {
  const { data } = await supabase
    .from("telegram_subscribers")
    .select("*")
    .eq("chat_id", chatId)
    .maybeSingle();
  return data;
}

async function upsertSubscriber(chatId: number, username: string | undefined, fields: object) {
  await supabase
    .from("telegram_subscribers")
    .upsert({ chat_id: chatId, username: username ?? null, ...fields }, { onConflict: "chat_id" });
}

// ── Webhook verification ───────────────────────────────────────────────────

function verifySecret(request: NextRequest): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return true; // not set in dev — skip
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(secret));
  } catch {
    return false;
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // ── Callback queries (button taps) ──────────────────────────────────────
  if (body.callback_query) {
    const cq = body.callback_query;
    const chatId: number = cq.message.chat.id;
    const messageId: number = cq.message.message_id;
    const data: string = cq.data ?? "";
    const username: string | undefined = cq.from?.username;

    await answerCallbackQuery(cq.id);

    // Unsubscribe
    if (data === "stop") {
      await upsertSubscriber(chatId, username, { active: false, pending_setup: false, setup_step: null });
      await editMessageText(
        chatId, messageId,
        "You've been unsubscribed. Did you find a slot? If this helped, consider buying me a coffee ☕",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "☕ Buy me a coffee", url: BUYMEACOFFEE_URL }],
              [{ text: "Found a slot ✓", callback_data: "stopped:found_slot" }],
              [{ text: "Didn't find anything useful", callback_data: "stopped:no_luck" }],
              [{ text: "Too many messages", callback_data: "stopped:too_many" }],
            ],
          },
        }
      );
      return NextResponse.json({ ok: true });
    }

    // Exit reason feedback
    if (data.startsWith("stopped:")) {
      const reason = data.replace("stopped:", "");
      await supabase
        .from("telegram_subscribers")
        .update({ stopped_reason: reason })
        .eq("chat_id", chatId);
      await editMessageText(chatId, messageId, "Thanks for the feedback!");
      return NextResponse.json({ ok: true });
    }

    // Confirm office selection
    if (data === "confirm") {
      const subscriber = await getSubscriber(chatId);
      const offices: string[] = subscriber?.offices ?? [];

      if (offices.length === 0) {
        await answerCallbackQuery(cq.id, "Please select at least one office first.");
        return NextResponse.json({ ok: true });
      }

      const officeText = offices.join(", ");

      await upsertSubscriber(chatId, username, {
        active: true, pending_setup: false, setup_step: "awaiting_email",
      });
      await editMessageText(
        chatId, messageId,
        `You're all set${subscriber?.first_name ? `, ${subscriber.first_name}` : ""}! Watching: <b>${officeText}</b>.\n\nOne more thing — want to leave an email as backup? Reply with it or say <b>skip</b>.`,
        { reply_markup: { inline_keyboard: [] } }
      );
      return NextResponse.json({ ok: true });
    }

    // Toggle a whole region
    if (data.startsWith("region:")) {
      const regionKey = data.replace("region:", "");
      const regionOffices = OFFICE_REGIONS[regionKey] ?? [];
      if (regionOffices.length === 0) return NextResponse.json({ ok: true });

      const subscriber = await getSubscriber(chatId);
      const current: string[] = subscriber?.offices ?? [];
      const allInRegion = regionOffices.every((o) => current.includes(o));
      const newOffices = allInRegion
        ? current.filter((o) => !regionOffices.includes(o))
        : [...new Set([...current, ...regionOffices])];

      await upsertSubscriber(chatId, username, { offices: newOffices });
      await editMessageReplyMarkup(chatId, messageId, buildKeyboard(newOffices));
      return NextResponse.json({ ok: true });
    }

    // Toggle individual office
    if (data.startsWith("toggle:")) {
      const office = data.replace("toggle:", "");
      if (!ALL_OFFICES.includes(office)) return NextResponse.json({ ok: true });

      const subscriber = await getSubscriber(chatId);
      const current: string[] = subscriber?.offices ?? [];
      const newOffices = current.includes(office)
        ? current.filter((o) => o !== office)
        : [...current, office];

      await upsertSubscriber(chatId, username, { offices: newOffices });
      await editMessageReplyMarkup(chatId, messageId, buildKeyboard(newOffices));
      return NextResponse.json({ ok: true });
    }
  }

  // ── Text messages / commands ─────────────────────────────────────────────
  if (body.message) {
    const msg = body.message;
    const chatId: number = msg.chat.id;
    const text: string = (msg.text ?? "").trim();
    const username: string | undefined = msg.from?.username;

    // /start — always resets setup
    if (text === "/start" || text.startsWith("/start ")) {
      await upsertSubscriber(chatId, username, {
        active: false, pending_setup: true, setup_step: "awaiting_name", offices: [],
      });
      await sendMessage(
        chatId,
        "Welcome to Maine BMV Slot Alerts! I'll message you the moment a short-notice appointment opens.\n\nFirst, what's your first name?"
      );
      return NextResponse.json({ ok: true });
    }

    // /stop
    if (text === "/stop") {
      await upsertSubscriber(chatId, username, { active: false, pending_setup: false, setup_step: null });
      await sendMessage(
        chatId,
        "You've been unsubscribed. Did you find a slot? If this helped, consider buying me a coffee ☕",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "☕ Buy me a coffee", url: BUYMEACOFFEE_URL }],
              [{ text: "Found a slot ✓", callback_data: "stopped:found_slot" }],
              [{ text: "Didn't find anything useful", callback_data: "stopped:no_luck" }],
              [{ text: "Too many messages", callback_data: "stopped:too_many" }],
            ],
          },
        }
      );
      return NextResponse.json({ ok: true });
    }

    // /status
    if (text === "/status") {
      const subscriber = await getSubscriber(chatId);
      if (!subscriber || !subscriber.active) {
        await sendMessage(chatId, "You're not subscribed. Send /start to sign up.");
      } else {
        const offices: string[] = subscriber.offices ?? [];
        const officeText = offices.length === 0 ? "all offices" : offices.join(", ");
        await sendMessage(chatId, `You're subscribed for: <b>${officeText}</b>.\n\nSend /start to change offices, or /stop to unsubscribe.`);
      }
      return NextResponse.json({ ok: true });
    }

    // Mid-setup: handle plain text based on setup_step
    const subscriber = await getSubscriber(chatId);
    const step = subscriber?.setup_step;

    if (step === "awaiting_name") {
      const name = text.slice(0, 50); // cap length
      await upsertSubscriber(chatId, username, { first_name: name, setup_step: "selecting_offices" });
      await sendMessage(
        chatId,
        `Nice to meet you, ${name}! Pick the offices you want alerts for.\n\nTap a region to select all offices in it, or tap individual offices.`,
        { reply_markup: buildKeyboard([]) }
      );
      return NextResponse.json({ ok: true });
    }

    if (step === "awaiting_email") {
      const lower = text.toLowerCase();
      if (lower !== "skip" && lower !== "no") {
        await upsertSubscriber(chatId, username, { email: text, setup_step: null });
      } else {
        await upsertSubscriber(chatId, username, { setup_step: null });
      }
      await sendMessage(
        chatId,
        "Done! I'll message you when a slot opens. To change offices anytime, send /start again."
      );
      return NextResponse.json({ ok: true });
    }

    // Default fallback
    await sendMessage(
      chatId,
      "Use /start to subscribe, /stop to unsubscribe, or /status to check your subscription."
    );
  }

  return NextResponse.json({ ok: true });
}

// Telegram pings this with GET to verify the webhook URL during setup
export async function GET() {
  return NextResponse.json({ ok: true, service: "Maine BMV Telegram Bot" });
}
