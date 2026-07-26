// ---------------------------------------------------------------------------
// Telegram webhook — the single public entry point of the whole product.
//
// Security posture:
//  1. Telegram's `X-Telegram-Bot-Api-Secret-Token` header is verified with a
//     constant-time compare BEFORE the body is parsed. An unauthenticated
//     request must not be able to make us do work (DoS amplification).
//  2. The endpoint always answers 200 to authenticated updates, even when the
//     handler fails. Telegram retries non-2xx responses, and a retry storm on
//     a poison update would take the bot offline; errors are logged instead.
//  3. No customer data is echoed in error responses.
// ---------------------------------------------------------------------------
import { after } from "next/server";
import { safeEqual } from "@/lib/auth";
import { handleUpdate } from "@/lib/telegram/handler";
import type { TelegramUpdate } from "@/lib/telegram/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[telegram] TELEGRAM_WEBHOOK_SECRET is not configured");
    return new Response("misconfigured", { status: 500 });
  }

  const provided = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(provided, secret)) {
    return new Response("forbidden", { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // Acknowledge immediately, process afterwards: analysis can take seconds and
  // Telegram times out webhook calls at ~60s, redelivering on timeout.
  after(async () => {
    try {
      await handleUpdate(update);
    } catch (err) {
      console.error("[telegram] update handling failed", {
        updateId: update.update_id,
        error: (err as Error).message,
      });
    }
  });

  return Response.json({ ok: true });
}
