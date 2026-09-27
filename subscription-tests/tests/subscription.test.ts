import { SubscriptionService } from "../src/service";
import { SubscriptionBuilder } from "../src/builders";
import { MockPaymentProvider } from "../src/paymentProvider";

describe("Subscription lifecycle", () => {
  let provider: MockPaymentProvider;
  let service: SubscriptionService;
  let builder: SubscriptionBuilder;

  beforeEach(() => {
    provider = new MockPaymentProvider();
    service = new SubscriptionService(provider);
    builder = new SubscriptionBuilder(service);
  });

  test("subscription starts trialing", () => {
    const sub = builder.trialing("cust_001", "pro");
    expect(sub.state).toBe("trialing");
  });

  test("trialing → active on payment success", () => {
    const sub = builder.trialing("cust_001", "pro");
    const updated = builder.withWebhookSuccess(sub.id, "inv_001");
    expect(updated.state).toBe("active");
    expect(updated.invoices).toContain("inv_001");
  });

  test("active → past_due on payment failure", () => {
    const sub = builder.trialing("cust_001", "pro");
    builder.withWebhookSuccess(sub.id, "inv_001");
    const updated = builder.withWebhookFailure(sub.id, "inv_002");
    expect(updated.state).toBe("past_due");
    expect(updated.invoices).toContain("inv_002");
  });

  test("idempotent webhook delivery", () => {
    const sub = builder.trialing("cust_001", "pro");
    service.processWebhook("evt_dup", "payment.succeeded", sub.id, "inv_001");
    service.processWebhook("evt_dup", "payment.succeeded", sub.id, "inv_001");
    const updated = service.getSubscription(sub.id)!;
    expect(updated.invoices.length).toBe(1);
  });

  test("canceled subscription ignores webhooks", () => {
    const sub = builder.trialing("cust_001", "pro");
    service.cancelSubscription(sub.id);
    service.processWebhook("evt_x", "payment.succeeded", sub.id, "inv_001");
    const updated = service.getSubscription(sub.id)!;
    expect(updated.state).toBe("canceled");
    expect(updated.invoices.length).toBe(0);
  });

  test("provider called once per billing attempt", async () => {
    const sub = service.createSubscription("cust_001", "pro");
    await service.attemptCharge(sub.id, sub.customerId, 4900, "pm_test_visa_4242");

    expect(provider.calls.length).toBe(1);
    expect(provider.calls[0]).toEqual({
      customerId: "cust_001",
      amount: 4900,
      paymentMethodId: "pm_test_visa_4242"
    });
  });

  test("invalid plan should throw error", () => {
    expect(() => service.createSubscription("cust_001", "invalid_plan"))
      .toThrow();
  });

  test("malformed webhook payload is ignored", () => {
    service.processWebhook("evt_bad", "unknown.event", "sub_fake", "inv_x");
    expect(service.getSubscription("sub_fake")).toBeUndefined();
  });

  test("provider decline moves subscription to past_due", async () => {
    // A declined charge should move the subscription to past_due.
    provider.charge = async () => false;
    const sub = service.createSubscription("cust_001", "pro");
    await service.attemptCharge(sub.id, sub.customerId, 4900, "pm_test_decline");

    expect(sub.state).toBe("past_due");
  });

  test("subscription created with correct plan config", () => {
    const sub = service.createSubscription("cust_001", "pro");
    expect(sub.trialDays).toBe(14);
    expect(sub.price).toBe(4900);
  });

  test("webhook with invalid signature is ignored", () => {
    const sub = service.createSubscription("cust_001", "pro");

    service.processWebhook("evt_bad", "payment.succeeded", sub.id, "inv_001", "wrong_sig", "{}");

    expect(sub.invoices.length).toBe(0);
    expect(sub.state).toBe("trialing");
  });

test("audit log records subscription creation and charge attempts", async () => {
  const sub = service.createSubscription("cust_001", "pro");
  expect(sub.auditLog).toContain("Subscription created in state trialing");

  await service.attemptCharge(sub.id, sub.customerId, 4900, "pm_test_visa_4242");
  const updated = service.getSubscription(sub.id)!;

  expect(updated.auditLog.some(entry => entry.includes("Charge attempt result"))).toBe(true);
});

test("audit log records webhook-driven state changes", () => {
  const sub = service.createSubscription("cust_001", "pro");

  service.processWebhook("evt_001", "payment.succeeded", sub.id, "inv_001");
  const updated = service.getSubscription(sub.id)!;

  expect(updated.auditLog).toContain("State changed to active via payment.succeeded");
});

test("webhook with invalid signature is ignored", () => {
  const sub = service.createSubscription("cust_001", "pro");

  service.processWebhook("evt_bad", "payment.succeeded", sub.id, "inv_001", "wrong_sig", "{}");

  const updated = service.getSubscription(sub.id)!;
  expect(updated.state).toBe("trialing"); // unchanged
  expect(updated.invoices.length).toBe(0);
  expect(updated.auditLog).not.toContain("State changed to active via payment.succeeded");
});

test("audit log records cancellation", () => {
  const sub = service.createSubscription("cust_001", "pro");
  service.cancelSubscription(sub.id);

  const updated = service.getSubscription(sub.id)!;
  expect(updated.state).toBe("canceled");
  expect(updated.auditLog).toContain("Subscription canceled via API");
});

test("payment.failed after payment.succeeded does not regress state", () => {
  const sub = service.createSubscription("cust_001", "pro");

  service.processWebhook("evt_001", "payment.succeeded", sub.id, "inv_001");
  expect(sub.state).toBe("active");

  // A later failure for the same invoice must not undo a successful payment.
  service.processWebhook("evt_002", "payment.failed", sub.id, "inv_001");
  expect(sub.state).toBe("active"); // should remain active
});

test("provider timeout does not change subscription state", async () => {
  provider.charge = async () => { throw new Error("timeout"); };

  const sub = service.createSubscription("cust_001", "pro");
  await service.attemptCharge(sub.id, sub.customerId, 4900, "pm_test_timeout");

  const updated = service.getSubscription(sub.id)!;
  expect(updated.state).toBe("trialing"); // unchanged
  expect(updated.auditLog.some(entry => entry.includes("timeout"))).toBeFalsy();
});

});

