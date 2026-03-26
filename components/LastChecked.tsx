"use client";
import { useEffect, useState } from "react";
import { supabase, ScrapeRun } from "@/lib/supabase";

function formatET(ts: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(ts) + " ET";
}

export default function LastChecked() {
  const [lastRun, setLastRun] = useState<ScrapeRun | null>(null);

  const fetchLastRun = async () => {
    const { data } = await supabase
      .from("scrape_runs")
      .select("*")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();
    if (data) setLastRun(data);
  };

  useEffect(() => {
    fetchLastRun();
    const channel = supabase
      .channel("scrape_runs_watch")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scrape_runs" }, fetchLastRun)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "scrape_runs" }, fetchLastRun)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  if (!lastRun?.completed_at) return null;

  return (
    <div className="text-sm text-gray-500">
      Last checked{" "}
      <span className="font-medium text-gray-700">
        {formatET(new Date(lastRun.completed_at))}
      </span>
    </div>
  );
}
