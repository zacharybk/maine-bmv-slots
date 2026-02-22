"use client";
import { useEffect, useState } from "react";
import { supabase, Appointment, OFFICES, BOOK_URL } from "@/lib/supabase";
import { format, parseISO, formatDistanceToNow } from "date-fns";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), "MMMM d, yyyy");
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "Many";
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function firstSeen(ts: string): string {
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}

type Filters = {
  offices: string[];
  available: "Y" | "N" | "all";
};

export default function AppointmentsTable() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [filters, setFilters] = useState<Filters>({ offices: [], available: "Y" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [officeOpen, setOfficeOpen] = useState(false);

  const fetchAppointments = async () => {
    let query = supabase
      .from("appointments")
      .select("*")
      .order("is_golden", { ascending: false })
      .order("available", { ascending: false })
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true, nullsFirst: true });

    if (filters.available === "Y") query = query.eq("available", true);
    if (filters.available === "N") query = query.eq("available", false);
    if (filters.offices.length > 0) query = query.in("office", filters.offices);

    const { data } = await query;
    if (data) setAppointments(data);
  };

  useEffect(() => {
    fetchAppointments();
    setPage(1);
  }, [filters]);

  useEffect(() => {
    fetchAppointments();
    const channel = supabase
      .channel("appointments_table")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, fetchAppointments)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Paginate
  const totalPages = Math.ceil(appointments.length / pageSize);
  const paginated = appointments.slice((page - 1) * pageSize, page * pageSize);

  const toggleOffice = (office: string) => {
    setFilters((f) => ({
      ...f,
      offices: f.offices.includes(office)
        ? f.offices.filter((o) => o !== office)
        : [...f.offices, office],
    }));
  };

  const clearOffices = () => setFilters((f) => ({ ...f, offices: [] }));

  return (
    <div>
      {/* ── Filters ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Office multi-select */}
        <div className="relative">
          <button
            onClick={() => setOfficeOpen((o) => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-gray-300 transition-colors"
          >
            {filters.offices.length === 0
              ? "All Offices"
              : `${filters.offices.length} office${filters.offices.length > 1 ? "s" : ""}`}
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {officeOpen && (
            <div className="absolute z-20 mt-1 w-52 rounded-xl bg-white border border-gray-200 shadow-lg p-2">
              <button
                onClick={clearOffices}
                className="w-full text-left px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-lg"
              >
                Clear (show all)
              </button>
              <div className="border-t border-gray-100 my-1" />
              {OFFICES.map((o) => (
                <label key={o} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.offices.includes(o)}
                    onChange={() => toggleOffice(o)}
                    className="rounded border-gray-300 text-gray-900"
                  />
                  <span className="text-sm text-gray-700">{o}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Available filter */}
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1">
          {(["Y", "all", "N"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setFilters((f) => ({ ...f, available: v }))}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                filters.available === v
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {v === "Y" ? "Available" : v === "N" ? "Gone" : "All"}
            </button>
          ))}
        </div>

        {/* Page size */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-sm text-gray-400">Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="text-sm rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-700"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Office</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Time</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">First Seen</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">
                  No appointments match your filters.
                </td>
              </tr>
            ) : (
              paginated.map((appt) => (
                <tr
                  key={appt.id}
                  className={
                    appt.is_golden && appt.available
                      ? "golden-row"
                      : appt.available
                      ? "hover:bg-gray-50"
                      : "opacity-50 hover:bg-gray-50"
                  }
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {appt.is_golden && appt.available && (
                        <span className="text-amber-500 text-base leading-none" title="Short-notice slot">★</span>
                      )}
                      <span className="font-medium text-gray-900 text-sm">{appt.office}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{formatDate(appt.appointment_date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                    {formatTime(appt.appointment_time)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400 hidden sm:table-cell">
                    {firstSeen(appt.first_seen_at)}
                  </td>
                  <td className="px-4 py-3">
                    {appt.available ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                        Available
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                        Gone
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {appt.available && (
                      <a
                        href={BOOK_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700 transition-colors"
                      >
                        Book
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ─────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-gray-400">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, appointments.length)} of {appointments.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white text-gray-700 disabled:opacity-40 hover:bg-gray-50"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white text-gray-700 disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
