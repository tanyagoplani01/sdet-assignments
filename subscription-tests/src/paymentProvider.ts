export interface PaymentProvider {
  charge(customerId: string, amount: number, paymentMethodId: string): Promise<boolean>;
}

export class MockPaymentProvider implements PaymentProvider {
  calls: { customerId: string; amount: number; paymentMethodId: string }[] = [];

  async charge(customerId: string, amount: number, paymentMethodId: string): Promise<boolean> {
    // Record requests so tests can verify the service passed the right values.
    this.calls.push({ customerId, amount, paymentMethodId });
    // Successful charges are the default; individual tests can override this.
    return true;
  }
}
