import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Appointment = {
  id: string;
  office: string;
  appointment_type: string;
  appointment_date: string;       // "2026-02-13"
  appointment_time: string | null; // "14:00:00" or null for future slots
  slot_type: "golden" | "future";
  is_golden: boolean;
  is_current_closest: boolean;
  available: boolean;
  first_seen_at: string;
  last_seen_at: string;
  book_url: string;
};

export type ScrapeRun = {
  id: string;
  run_at: string;
  completed_at: string | null;
  offices_scraped: number;
  golden_slots_found: number;
  future_slots_found: number;
};

export const OFFICES = [
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
] as const;

export const BOOK_URL =
  "https://mainebmvappt.cxmflow.com/Appointment/Index/2c052fc7-571f-4b76-9790-7e91f103c408";
