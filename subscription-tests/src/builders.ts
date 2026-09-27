import { SubscriptionService } from "./service";

export class SubscriptionBuilder {
  constructor(private service: SubscriptionService) {}

  trialing(customerId: string, plan: string) {
    return this.service.createSubscription(customerId, plan);
  }

  withWebhookSuccess(subId: string, invoiceId: string) {
    // Give each builder action its own event id, just like a real webhook.
    this.service.processWebhook("evt_" + Math.random(), "payment.succeeded", subId, invoiceId);
    return this.service.getSubscription(subId)!;
  }

  withWebhookFailure(subId: string, invoiceId: string) {
    this.service.processWebhook("evt_" + Math.random(), "payment.failed", subId, invoiceId);
    return this.service.getSubscription(subId)!;
  }
}
