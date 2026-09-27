import { PaymentProvider } from "./paymentProvider";
import * as crypto from "crypto";

export type SubscriptionState = "trialing" | "active" | "past_due" | "canceled";

export interface Subscription {
  id: string;
  customerId: string;
  plan: string;
  state: SubscriptionState;
  invoices: string[];
  trialDays: number;
  price: number;
  auditLog: string[];
}

// Keeping plan details in one place makes subscription creation predictable.
const planConfig: Record<string, { trialDays: number; price: number }> = {
  basic: { trialDays: 7, price: 1000 },
  pro: { trialDays: 14, price: 4900 },
};

const WEBHOOK_SECRET = "test_secret";

function verifySignature(payload: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET)
                         .update(payload)
                         .digest("hex");
  return expected === signature;
}

export class SubscriptionService {
  private subscriptions: Map<string, Subscription> = new Map();
  private events: Set<string> = new Set();

  constructor(private provider: PaymentProvider) {}

  createSubscription(customerId: string, plan: string): Subscription {
    // Reject unknown plans before creating any subscription state.
    if (!planConfig[plan]) {
      throw new Error(`Invalid plan: ${plan}`);
    }

    const config = planConfig[plan];
    const id = "sub_" + Math.random().toString(36).substring(2, 8);

    const sub: Subscription = {
      id,
      customerId,
      plan,
      state: "trialing",
      invoices: [],
      trialDays: config.trialDays,
      price: config.price,
      auditLog: [`Subscription created in state trialing`]
    };

    this.subscriptions.set(id, sub);
    return sub;
  }

  async attemptCharge(subscriptionId: string, customerId: string, amount: number, paymentMethodId: string) {
  const sub = this.subscriptions.get(subscriptionId);
  if (!sub) return;

  try {
    const success = await this.provider.charge(customerId, amount, paymentMethodId);
    sub.state = success ? "active" : "past_due";
    sub.auditLog.push(`Charge attempt result: ${success ? "success" : "failure"}`);
  } catch (err) {
      // A provider outage is not the same as a declined payment.
      // Leave the subscription in its current state so it can be retried.
  }
}

  processWebhook(
    eventId: string,
    type: string,
    subscriptionId: string,
    invoiceId: string,
    signature?: string,
    rawBody?: string
  ) {
    // Ignore signed requests that do not match the expected payload.
    if (signature && rawBody && !verifySignature(rawBody, signature)) {
      return; // ignore invalid signature
    }

    // Webhooks can be delivered more than once, so process each event once.
    if (this.events.has(eventId)) return;
    this.events.add(eventId);

    const sub = this.subscriptions.get(subscriptionId);
    if (!sub || sub.state === "canceled") return;

    switch (type) {
      case "payment.succeeded":
        if (sub.state === "trialing" || sub.state === "past_due") {
          sub.state = "active";
          sub.invoices.push(invoiceId);
          sub.auditLog.push(`State changed to active via ${type}`);
        }
        break;
      case "payment.failed":
        if (sub.invoices.includes(invoiceId)) {
          break;
        }
        if (sub.state === "trialing" || sub.state === "active") {
          sub.state = "past_due";
          sub.invoices.push(invoiceId);
          sub.auditLog.push(`State changed to past_due via ${type}`);
        }
        break;
      case "payment.refunded":
        sub.invoices.push(invoiceId);
        sub.auditLog.push(`Invoice ${invoiceId} refunded`);
        break;
    }
  }

  getSubscription(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  cancelSubscription(id: string) {
    const sub = this.subscriptions.get(id);
    if (sub && sub.state !== "canceled") {
      sub.state = "canceled";
      sub.auditLog.push("Subscription canceled via API");
    }
  }

}
