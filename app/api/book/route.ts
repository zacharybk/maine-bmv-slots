import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BMV_URL = "https://mainebmvappt.cxmflow.com/Appointment/Index/2c052fc7-571f-4b76-9790-7e91f103c408";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chat_id");
  const office = searchParams.get("office");

  await supabase.from("book_clicks").insert({
    chat_id: chatId ? parseInt(chatId, 10) : null,
    office: office ?? null,
  });

  return NextResponse.redirect(BMV_URL);
}
