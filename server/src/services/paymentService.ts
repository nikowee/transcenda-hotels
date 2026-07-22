/**
 * PaymentService — the «External API» box from the UC4 class diagram.
 *
 * Diagram signature is processPayment(amount, currency); a third argument
 * carries the instrument, since the gateway cannot charge without one.
 *
 * Runs against real Stripe when STRIPE_SECRET_KEY is present. Without it the
 * gateway is simulated so the payment-failure alternative flow (steps 6a-9a)
 * stays exercisable locally — declines are triggered by Stripe's own canonical
 * test card, 4000 0000 0000 0002.
 */

export interface PaymentMethodInput {
  cardNumber: string;
  expiry: string;
  cvc: string;
  nameOnCard: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  /** Surfaced to the user verbatim on failure (step 7a) */
  errorMessage?: string;
  declineCode?: string;
}

const DECLINE_TEST_CARD = '4000000000000002';

const normaliseCard = (cardNumber: string) => cardNumber.replace(/\D/g, '');

export const isStripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY);

/** Sequence diagram step 5: processPayment(amount, currency) → step 6: return result */
export const processPayment = async (
  amount: number,
  currency: string,
  paymentMethod: PaymentMethodInput
): Promise<PaymentResult> => {
  const card = normaliseCard(paymentMethod.cardNumber);

  if (!isStripeConfigured()) {
    // Simulated gateway. Deliberately mirrors the shape of the Stripe branch
    // below so swapping in real credentials changes nothing downstream.
    await new Promise((resolve) => setTimeout(resolve, 600));

    if (card === DECLINE_TEST_CARD) {
      return {
        success: false,
        errorMessage: 'Your card was declined. Please try a different payment method.',
        declineCode: 'card_declined',
      };
    }

    if (card.length < 13 || card.length > 19) {
      return {
        success: false,
        errorMessage: 'That card number does not look valid. Please check and try again.',
        declineCode: 'invalid_number',
      };
    }

    return {
      success: true,
      transactionId: `sim_${Date.now().toString(36)}`,
    };
  }

  try {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe bills in the smallest unit
      currency: currency.toLowerCase(),
      payment_method_types: ['card'],
      confirm: false,
      metadata: { nameOnCard: paymentMethod.nameOnCard },
    });

    return { success: true, transactionId: intent.id };
  } catch (error: any) {
    return {
      success: false,
      errorMessage: error?.message ?? 'Payment could not be processed. Please try again.',
      declineCode: error?.code,
    };
  }
};
