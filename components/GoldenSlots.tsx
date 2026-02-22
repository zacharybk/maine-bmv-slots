"use client";
import { useEffect, useState } from "react";
import { supabase, Appointment, BOOK_URL } from "@/lib/supabase";
import { format, parseISO } from "date-fns";

function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), "EEEE, MMMM d, yyyy");
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const appt = parseISO(dateStr);
  return Math.ceil((appt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function GoldenSlots() {
  const [slots, setSlots] = useState<Appointment[]>([]);

  const fetchSlots = async () => {
    const { data } = await supabase
      .from("appointments")
      .select("*")
      .eq("slot_type", "golden")
      .eq("available", true)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });
    if (data) setSlots(data);
  };

  useEffect(() => {
    fetchSlots();

    const channel = supabase
      .channel("golden_slots")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, fetchSlots)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  if (slots.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg font-bold text-gray-900">Short-Notice Slots</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
          {slots.length} available
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Appointments within 8 days — book fast, these go quickly.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {slots.map((slot) => {
          const days = daysUntil(slot.appointment_date);
          const isToday = days === 0;
          const isTomorrow = days === 1;

          return (
            <div
              key={slot.id}
              className="golden-row rounded-xl border border-amber-300 p-4 shadow-sm flex flex-col gap-2"
            >
              {/* Badge */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  {isToday ? "TODAY" : isTomorrow ? "TOMORROW" : `${days} days away`}
                </span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                  Available
                </span>
              </div>

              {/* Office + Date */}
              <div>
                <div className="font-bold text-gray-900 text-base">{slot.office}</div>
                <div className="text-gray-700 text-sm mt-0.5">{formatDate(slot.appointment_date)}</div>
                <div className="text-gray-600 text-sm font-medium">
                  {slot.appointment_time ? formatTime(slot.appointment_time) : ""}
                </div>
              </div>

              {/* Book Now */}
              <a
                href={BOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-flex items-center justify-center gap-1.5 w-full rounded-lg bg-gray-900 text-white text-sm font-semibold py-2.5 hover:bg-gray-700 transition-colors"
              >
                Book Now
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
