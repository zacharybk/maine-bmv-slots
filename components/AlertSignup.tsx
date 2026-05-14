"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "MaineBMVBot";

export default function AlertSignup() {
  const [showFallback, setShowFallback] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", channel: "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await supabase.from("notification_interest").insert({
      name: form.name,
      email: form.email,
      channel: form.channel,
    });
    setLoading(false);
    setSubmitted(true);
  }

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
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
        <form onSubmit={handleSubmit} className="mt-3 space-y-2">
          <input
            type="text"
            placeholder="First name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white"
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white"
            required
          />
          <div className="text-xs text-gray-500 font-medium pt-1">How do you want to receive alerts?</div>
          <div className="flex flex-wrap gap-3">
            {["SMS", "WhatsApp", "Email", "Other"].map(ch => (
              <label key={ch} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
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
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-1.5 rounded-lg bg-gray-800 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Submit"}
          </button>
        </form>
      )}

      {submitted && (
        <p className="mt-2 text-xs text-gray-500">Got it — we'll keep this in mind for future channels.</p>
      )}
    </div>
  );
}
