# Decision Log

Decisions 1–7 belong to the v1 public platform. Decisions 8+ cover the v2 pivot
to a private, subscription-gated Telegram product.

---

## v2 — Private subscription product

### 8. Telegram is the product, the web is the back office

**Decision:** Customers interact exclusively through a Telegram bot. The web
app has no public signup and no customer login; it exists only for the owner
console.

**Why:** The requirement is a private, sellable service — not a public venue.
Telegram gives push delivery (a signal is worthless if unseen), an identity
system we do not have to build or secure, and zero install friction for Arabic
retail traders. Removing the public web surface deletes an entire class of
attacks (credential stuffing, session hijacking, public enumeration) rather
than defending against it.

### 9. `telegram_id` is the identity — no customer passwords

**Decision:** `customers` has no password column. Staff auth lives in a
separate `admin_users` table.

**Why:** Passwords we never store cannot leak, be reused, or be phished. It
also keeps the highest-privilege surface (owner console) on a completely
separate credential path from the customer base.

### 10. Plans are data, not code

**Decision:** Tiers live in a `plans` table with a JSON `features` object;
entitlements are read at runtime. `featuresSnapshot` is copied onto the
subscription at purchase.

**Why:** Adding or repricing a tier must be an INSERT, not a deploy. The
snapshot means editing a plan cannot retroactively downgrade a paying
customer — a correctness property that also protects trust.

### 11. Refusals are first-class, and they are stored

**Decision:** `wait` and `reject` are successful outcomes with named causes,
and every decision is persisted — not just the ones that became signals.

**Why:** Two reasons. Product: "why aren't you trading?" is a core feature of a
disciplined assistant; silence looks broken. Integrity: stored refusals are the
honest denominator for any performance claim. A vendor who stores only wins can
report any win rate they like.

### 12. Signals only — no execution, no customer API keys

**Decision:** The system never places orders. `MarketDataSource` has **no**
order-placement method, and no customer exchange credentials are ever
collected.

**Why:** Explicit user requirement ("لا اريده يتداول هو ويفتح الصفقات"), and it
is the right posture regardless: custody of trading keys turns a signal service
into a fiduciary with a catastrophic breach profile. Encoding this in the type
system rather than a policy document means it cannot be violated by accident —
there is no method to call.

### 13. Multi-exchange data behind a circuit breaker

**Decision:** Binance → Bybit → OKX with failover; simulator last and disabled
in production unless explicitly allowed.

**Why:** Public market data needs no API key, so multi-venue redundancy is free
and an outage degrades quality instead of stopping the product. A circuit
breaker (not retries) because blind retries during an outage stall the whole
scan loop. The simulator is gated behind `ALLOW_SIMULATED_DATA` so customers
can never be served synthetic prices by accident.

### 14. Arabic lives in exactly one file

**Decision:** Analysers emit `ReasonCode` enums; `messages.ar.ts` is the sole
place Arabic user-facing copy exists.

**Why:** Mixing display strings into trading logic makes the engine untestable
and localisation impossible. Machine codes are also what get stored in
`signals`, so historical data stays language-neutral and re-renderable.

### 15. Thresholds are measured, not guessed

**Decision:** `minConfluence = 52`, derived from a calibration study
(`npm run calibrate`) rather than intuition.

**Why:** The first version used 62 and the engine **never fired** — a textbook
A+ setup scored 60. Measuring showed random market noise reaching p99 = 47
while genuine setups score 54–55. A threshold must sit in that gap; picking it
by feel produces either a silent bot or one that sells noise. The script is
committed so the number can be re-derived after any change.

### 16. Confluence = agreement × coverage (two separate questions)

**Decision:** Abstaining analysers are excluded from the directional average
and instead reduce a coverage factor. Volatility never votes on direction.

**Why:** A plain weighted average treats "no opinion" as "disagrees", which
suppressed real setups below the entry gate (measured: 44 for a textbook
trend). Separating *do they agree* from *how many spoke* fixed it without
letting one loud analyser reach a perfect score.

### 17. A far structural stop means "wait", never a wider stop

**Decision:** If no structural level sits within 4 ATR, `buildTradePlan`
returns `EXTENDED_FROM_STRUCTURE` → verdict `wait`, instead of falling back to
a volatility stop.

**Why:** An ATR fallback in that situation silently re-enables price-chasing —
the exact behaviour the engine exists to prevent. The distinction matters to
the customer too: "the setup is valid but you are late" is actionable advice,
while "rejected" is not. (Structureless fresh ranges still get an ATR stop —
that case is genuinely different.)

### 18. Position size is capped at 25% of portfolio

**Decision:** Cap `positionSizePct`; when the cap binds, effective risk is
lower than budget, never higher.

**Why:** The standard formula `risk% / stopDistance%` returns >100% of equity
on a tight stop. Printing "حجم المركز: 105%" in a signal silently assumes
leverage the customer may not have — irresponsible for a paid product, and it
appeared in real output during testing.

### 19. Conservative fill assumptions

**Decision:** If price touched both stop and target, assume the **stop** filled
first. Never close a customer's trade on a price we could not fetch.

**Why:** Optimistic fill assumptions are how vendors publish win rates their
customers never achieve. Being pessimistic in our own reporting is a trust
asset.

### 20. The learning loop calibrates probability only, with hard limits

**Decision:** No adaptation below 25 samples; adjustments shrunk toward
neutral; multiplier clamped to `[0.7, 1.15]`. Risk rules are never calibrated.

**Why:** Reacting to five trades is noise-chasing, not learning. Bounded,
shrunk adjustments mean one bad week cannot collapse the engine's behaviour.
Risk limits are policy — a model permitted to optimise its own risk ceiling
will eventually optimise it away.

### 21. Webhook: verify first, always 200, process after

**Decision:** Constant-time secret compare before parsing the body; return 200
to authenticated updates even on handler failure; heavy work in `after()`.

**Why:** Verifying before parsing prevents unauthenticated requests from
causing work (DoS amplification). Telegram retries non-2xx responses, so
returning 500 on a poison update creates a retry storm that takes the bot
offline. Analysis can exceed Telegram's webhook timeout, hence deferred
processing.

### 22. Manual/licence-key billing first, provider layer behind it

**Decision:** Ship owner-activated subscriptions and hashed licence keys; model
`payments` with a `provider` column and unique `(provider, providerRef)`.

**Why:** The target market commonly pays by transfer or USDT, and card
processors are slow to approve trading-adjacent businesses. This earns revenue
immediately while the ledger shape already accommodates Stripe or automated
crypto confirmation with no migration.

---

## v1 — Original platform (retained for history)

### 1. Next.js App Router + server components for data fetching
Dashboard pages read directly from the database rather than calling the app's
own REST API, avoiding an unnecessary network hop and cookie-forwarding
complexity. *(Largely superseded — the dashboard was removed in v2.)*

### 2. Opaque session tokens instead of JWT
A trading product must be able to revoke a session instantly. Stateless JWTs
cannot be revoked before expiry without a denylist, which reintroduces
server-side state anyway. **Retained in v2** for the owner console.

### 3. Deterministic synthetic market data
A seeded GBM + volatility-clustering engine behind the same interface a real
adapter uses. **Retained in v2** as the last-priority fallback source and as
the substrate for the threshold calibration study.

### 4. Single-position-per-symbol model
Kept margin and UI semantics unambiguous. *(v2 equivalent: the
`REJECT_EXPOSURE_LIMIT` gate prevents stacking signals on one symbol.)*

### 5. `numeric` Postgres columns for monetary values
Floating point is unacceptable for financial figures. **Retained in v2** for
prices, payments, and R-multiples.

### 6. Client-generated UUID primary keys
Avoids a hard dependency on the `pgcrypto` extension. **Retained in v2.**

### 7. Daily-loss circuit breaker was a documented placeholder
*(Obsolete: v2 does not manage accounts. The equivalent controls are the
`REJECT_DAILY_LIMIT` and cooldown gates.)*
