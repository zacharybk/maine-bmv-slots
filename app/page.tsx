import GoldenSlots from "@/components/GoldenSlots";
import AppointmentsTable from "@/components/AppointmentsTable";
import LastChecked from "@/components/LastChecked";
import EmailSignup from "@/components/EmailSignup";

export default function Home() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Maine BMV Real ID Slots
            </h1>
            <p className="text-gray-500 text-sm mt-1 max-w-lg">
              Live tracker for Driver's License &amp; Real ID appointments at all 13 Maine BMV offices.
              Short-notice slots highlighted. Checks every 5 minutes.
            </p>
          </div>
          <LastChecked />
        </div>
      </div>

      {/* ── Golden Slots (pinned) ───────────────────────────── */}
      <GoldenSlots />

      {/* ── All Appointments Table ──────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-900">All Appointments</h2>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          ★ = short-notice slot · "Many" in time column = next available future date (exact times not shown)
        </p>
        <AppointmentsTable />
      </div>

      {/* ── Email Signup ─────────────────────────────────────── */}
      <div className="mt-10 max-w-md">
        <EmailSignup />
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="mt-12 border-t border-gray-200 pt-6 text-xs text-gray-400">
        Data sourced from{" "}
        <a
          href="https://mainebmvappt.cxmflow.com/Appointment/Index/2c052fc7-571f-4b76-9790-7e91f103c408"
          className="underline hover:text-gray-600"
          target="_blank"
          rel="noopener noreferrer"
        >
          mainebmvappt.cxmflow.com
        </a>
        . Not affiliated with the Maine BMV. Updates every 5 minutes.
      </footer>
    </main>
  );
}
