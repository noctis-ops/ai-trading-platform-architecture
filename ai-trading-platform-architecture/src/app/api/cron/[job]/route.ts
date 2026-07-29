// ---------------------------------------------------------------------------
// Cron entry point — /api/cron/{scan|track|outcomes|expiry|report-daily|...}
//
// Security: protected by a bearer secret compared in constant time. These
// endpoints move money-adjacent state (subscription expiry) and cost money
// (exchange calls), so an open URL would be both a DoS vector and a way to
// force-expire customers.
//
// Deployment: any scheduler works (Vercel Cron, GitHub Actions, systemd
// timer, cron + curl). Suggested cadence is in docs/OPERATIONS.md.
// ---------------------------------------------------------------------------
import { safeEqual } from "@/lib/auth";
import { runExpiryJob, runOutcomesJob, runReportJob, runScanJob, runTrackJob, runCalendarJob, runTradingSyncJob, type JobResult } from "@/lib/engine/jobs";
import { alertOwners } from "@/lib/telegram/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Scans hit several venues sequentially; give them room. */
export const maxDuration = 300;

const JOBS: Record<string, () => Promise<JobResult>> = {
  scan: runScanJob,
  track: runTrackJob,
  outcomes: runOutcomesJob,
  expiry: () => runExpiryJob(),
  calendar: () => runCalendarJob(),
  "report-daily": () => runReportJob("daily"),
  "report-weekly": () => runReportJob("weekly"),
  "report-monthly": () => runReportJob("monthly"),
  "trading-sync": runTradingSyncJob,
};

export async function POST(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not configured");
    return Response.json({ ok: false, error: "misconfigured" }, { status: 500 });
  }

  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(provided, secret)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { job } = await ctx.params;
  const runner = JOBS[job];
  if (!runner) {
    return Response.json({ ok: false, error: "unknown job", available: Object.keys(JOBS) }, { status: 404 });
  }

  const startedAt = Date.now();
  try {
    const result = await runner();
    console.log("[cron] completed", { job, ms: Date.now() - startedAt, ...result.details });
    return Response.json({ ...result, durationMs: Date.now() - startedAt });
  } catch (err) {
    // 500 here is correct (unlike the Telegram webhook): a scheduler SHOULD
    // retry a failed job, and we want the failure visible in monitoring.
    console.error("[cron] failed", { job, error: (err as Error).message });
    await alertOwners(`🚨 فشل مهمة مجدولة (${job}):\n\n${(err as Error).message}`).catch(console.error);
    return Response.json({ job, ok: false, error: (err as Error).message }, { status: 500 });
  }
}
