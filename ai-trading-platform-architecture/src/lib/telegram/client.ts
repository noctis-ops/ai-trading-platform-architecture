// ---------------------------------------------------------------------------
// Telegram Bot API client + delivery queue semantics.
//
// Two hard operational realities drive this design:
//   1. Telegram rate-limits bots to ~30 messages/second globally and ~1
//      message/second per chat. A 500-subscriber fan-out sent naively gets the
//      bot throttled or banned, so `broadcast` paces itself.
//   2. Customers block bots. A 403 is NOT a retryable error — it is a
//      permanent state change that must be written back to the customer row,
//      otherwise the queue retries forever.
// ---------------------------------------------------------------------------

export type SendResult =
  | { ok: true; messageId: number }
  | { ok: false; retryable: boolean; error: string; blockedByUser?: boolean; retryAfterSec?: number };

export type TelegramConfig = {
  botToken: string;
  apiBase?: string;
  /** Global send budget; Telegram's documented ceiling is 30/s. */
  messagesPerSecond?: number;
};

type TelegramResponse = {
  ok: boolean;
  result?: { message_id: number };
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export class TelegramClient {
  private readonly apiBase: string;
  private readonly minIntervalMs: number;
  private lastSentAt = 0;

  constructor(private readonly config: TelegramConfig) {
    if (!config.botToken) throw new Error("TELEGRAM_BOT_TOKEN is required");
    this.apiBase = config.apiBase ?? "https://api.telegram.org";
    this.minIntervalMs = 1000 / (config.messagesPerSecond ?? 25);
  }

  private get base() {
    return `${this.apiBase}/bot${this.config.botToken}`;
  }

  private async pace() {
    const wait = this.lastSentAt + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastSentAt = Date.now();
  }

  async sendMessage(chatId: string | bigint, text: string, opts: { silent?: boolean } = {}): Promise<SendResult> {
    await this.pace();
    try {
      const res = await fetch(`${this.base}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId.toString(),
          text,
          // Plain text: Arabic copy contains characters that MarkdownV2 would
          // require escaping, and a formatting error must never eat a signal.
          disable_web_page_preview: true,
          disable_notification: opts.silent ?? false,
        }),
      });

      const data = (await res.json()) as TelegramResponse;

      if (data.ok && data.result) return { ok: true, messageId: data.result.message_id };

      const code = data.error_code ?? res.status;
      if (code === 403) {
        return { ok: false, retryable: false, error: data.description ?? "blocked", blockedByUser: true };
      }
      if (code === 429) {
        return {
          ok: false,
          retryable: true,
          error: data.description ?? "rate limited",
          retryAfterSec: data.parameters?.retry_after ?? 5,
        };
      }
      // 400 = malformed request (our bug). Retrying cannot fix it.
      return { ok: false, retryable: code >= 500, error: data.description ?? `HTTP ${code}` };
    } catch (err) {
      return { ok: false, retryable: true, error: (err as Error).message };
    }
  }

  /**
   * Paced fan-out. Returns per-recipient results so the caller can write the
   * delivery log and deactivate customers who blocked the bot.
   */
  async broadcast(
    recipients: { customerId: string; chatId: bigint }[],
    text: string | ((customerId: string) => string),
  ): Promise<{ customerId: string; result: SendResult }[]> {
    const out: { customerId: string; result: SendResult }[] = [];
    for (const r of recipients) {
      const body = typeof text === "function" ? text(r.customerId) : text;
      let result = await this.sendMessage(r.chatId, body);
      if (!result.ok && result.retryable && result.retryAfterSec) {
        await sleep(result.retryAfterSec * 1000);
        result = await this.sendMessage(r.chatId, body);
      }
      out.push({ customerId: r.customerId, result });
    }
    return out;
  }

  async setWebhook(url: string, secretToken: string): Promise<boolean> {
    const res = await fetch(`${this.base}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secretToken,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      }),
    });
    return ((await res.json()) as TelegramResponse).ok;
  }

  async setMyCommands(commands: { command: string; description: string }[]): Promise<boolean> {
    const res = await fetch(`${this.base}/setMyCommands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    return ((await res.json()) as TelegramResponse).ok;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Update types (only the fields this product consumes)
// ---------------------------------------------------------------------------
export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string; language_code?: string; is_bot?: boolean };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string; first_name?: string };
    data?: string;
  };
};
