"use client";
import { useEffect, useState } from "react";
import { supabase, ScrapeRun } from "@/lib/supabase";
import { formatDistanceToNow, format } from "date-fns";

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

    // Subscribe to new scrape_runs
    const channel = supabase
      .channel("scrape_runs_watch")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scrape_runs" }, fetchLastRun)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "scrape_runs" }, fetchLastRun)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  if (!lastRun?.completed_at) {
    return <span className="text-sm text-gray-400">Checking now...</span>;
  }

  const ts = new Date(lastRun.completed_at);

  return (
    <div className="text-sm text-gray-500">
      Last checked{" "}
      <span className="font-medium text-gray-700">
        {format(ts, "MMMM d, yyyy 'at' h:mm a")}
      </span>{" "}
      <span className="text-gray-400">
        ({formatDistanceToNow(ts, { addSuffix: true })})
      </span>
    </div>
  );
}
