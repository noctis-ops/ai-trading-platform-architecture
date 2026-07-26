// ---------------------------------------------------------------------------
// Access control tests.
//
// This is revenue-critical logic: a false "allowed" gives the product away,
// and a false "denied" locks out a paying customer. Both directions are
// tested explicitly.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkQuota,
  checkSymbolAccess,
  denialAr,
  evaluateAccess,
  isGrant,
  requireFeature,
  type CustomerRecord,
  type SubscriptionRecord,
} from "../entitlements";

const NOW = new Date("2026-07-26T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const active: CustomerRecord = { id: "c1", status: "active" };

const sub = (over: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  id: "s1",
  status: "active",
  currentPeriodEnd: days(20),
  pausedAt: null,
  planCode: "pro",
  featuresSnapshot: {},
  ...over,
});

test("grants access to an active customer with a live subscription", () => {
  const r = evaluateAccess(active, sub(), NOW);
  assert.ok(isGrant(r));
  assert.equal(r.planCode, "pro");
  assert.equal(r.daysRemaining, 20);
  assert.equal(r.expiringSoon, false);
});

test("denies an unknown telegram user", () => {
  const r = evaluateAccess(null, null, NOW);
  assert.equal(r.allowed, false);
  assert.equal(!isGrant(r) && r.code, "NOT_REGISTERED");
});

test("denies when the paid period has elapsed", () => {
  const r = evaluateAccess(active, sub({ currentPeriodEnd: days(-3) }), NOW);
  assert.equal(!isGrant(r) && r.code, "SUBSCRIPTION_EXPIRED");
  assert.equal(!isGrant(r) && r.detail?.daysAgo, 3);
});

test("expiry is exact at the boundary", () => {
  assert.ok(isGrant(evaluateAccess(active, sub({ currentPeriodEnd: new Date(NOW.getTime() + 1000) }), NOW)));
  assert.equal(evaluateAccess(active, sub({ currentPeriodEnd: NOW }), NOW).allowed, false);
});

test("flags the renewal window", () => {
  const r = evaluateAccess(active, sub({ currentPeriodEnd: days(2) }), NOW);
  assert.ok(isGrant(r) && r.expiringSoon);
});

test("a ban outranks billing state", () => {
  // A banned user must never be invited to pay.
  const r = evaluateAccess({ id: "c1", status: "banned" }, sub(), NOW);
  assert.equal(!isGrant(r) && r.code, "BANNED");
});

test("suspension blocks access even with time remaining", () => {
  const r = evaluateAccess({ id: "c1", status: "suspended" }, sub(), NOW);
  assert.equal(!isGrant(r) && r.code, "SUSPENDED");
});

test("owner pause blocks access without deleting the subscription", () => {
  const r = evaluateAccess(active, sub({ pausedAt: NOW }), NOW);
  assert.equal(!isGrant(r) && r.code, "SUBSCRIPTION_PAUSED");
});

test("cancellation still honours the period already paid for", () => {
  assert.ok(isGrant(evaluateAccess(active, sub({ status: "canceled", currentPeriodEnd: days(5) }), NOW)));
  const past = evaluateAccess(active, sub({ status: "canceled", currentPeriodEnd: days(-1) }), NOW);
  assert.equal(!isGrant(past) && past.code, "SUBSCRIPTION_CANCELED");
});

test("a pending customer who has paid is served", () => {
  assert.ok(isGrant(evaluateAccess({ id: "c1", status: "pending" }, sub(), NOW)));
  const noSub = evaluateAccess({ id: "c1", status: "pending" }, null, NOW);
  assert.equal(!isGrant(noSub) && noSub.code, "PENDING_APPROVAL");
});

test("plan features gate locked capabilities", () => {
  const grant = evaluateAccess(active, sub({ featuresSnapshot: { weeklyReports: false } }), NOW);
  assert.ok(isGrant(grant));
  assert.equal(requireFeature(grant, "weeklyReports").allowed, false);
  assert.equal(requireFeature(grant, "dailyReports").allowed, true);
});

test("metered quotas are enforced, and -1 means unlimited", () => {
  const limited = evaluateAccess(active, sub({ featuresSnapshot: { onDemandAnalysisPerDay: 3 } }), NOW);
  assert.ok(isGrant(limited));
  assert.equal(checkQuota(limited, 2).allowed, true);
  assert.equal(checkQuota(limited, 3).allowed, false);

  const unlimited = evaluateAccess(active, sub({ featuresSnapshot: { onDemandAnalysisPerDay: -1 } }), NOW);
  assert.ok(isGrant(unlimited));
  assert.equal(checkQuota(unlimited, 9999).allowed, true);
});

test("symbol access follows the plan tier", () => {
  const tier = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
  const basic = evaluateAccess(active, sub({ featuresSnapshot: { maxSymbols: 2 } }), NOW);
  assert.ok(isGrant(basic));
  assert.equal(checkSymbolAccess(basic, "ETHUSDT", tier).allowed, true);
  assert.equal(checkSymbolAccess(basic, "XRPUSDT", tier).allowed, false);
});

test("every denial renders a non-empty Arabic message", () => {
  const denials = [
    evaluateAccess(null, null, NOW),
    evaluateAccess(active, null, NOW),
    evaluateAccess(active, sub({ currentPeriodEnd: days(-1) }), NOW),
    evaluateAccess({ id: "c1", status: "banned" }, sub(), NOW),
    evaluateAccess({ id: "c1", status: "suspended" }, sub(), NOW),
    evaluateAccess(active, sub({ pausedAt: NOW }), NOW),
  ];
  for (const d of denials) {
    assert.equal(d.allowed, false);
    if (!isGrant(d)) {
      const text = denialAr(d);
      assert.ok(text.length > 10, `${d.code} must have Arabic copy`);
      assert.ok(/[\u0600-\u06FF]/.test(text), `${d.code} must actually be Arabic`);
    }
  }
});
