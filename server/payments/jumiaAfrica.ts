import crypto from 'node:crypto';
import { getWebhookSecret } from '../crypto.ts';
import type { PaymentMethodId } from '../../src/shared/types.ts';

export interface PaymentSessionRequest {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  method: PaymentMethodId;
  buyerEmail: string;
  buyerName: string;
  returnUrl: string;
}

export interface PaymentSessionResponse {
  provider: 'jumia_africa';
  environment: 'sandbox' | 'production';
  providerRef: string;
  checkoutUrl: string;
  expiresAt: string;
}

export interface WebhookVerificationResult {
  valid: boolean;
  providerRef: string;
  status: 'paid' | 'failed' | 'cancelled' | 'refunded';
  amount: number;
  rawEvent: Record<string, unknown>;
}

export interface RefundResult {
  success: boolean;
  refundRef: string;
  reason?: string;
}

/**
 * Risk R-01 mitigation: Payment provider abstracted behind an internal interface
 * so a secondary PSP can be plugged in without rewriting order logic.
 */
export interface PaymentProvider {
  readonly name: string;
  initiateSession(req: PaymentSessionRequest): Promise<PaymentSessionResponse>;
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): WebhookVerificationResult | null;
  signSandboxWebhook(payload: Record<string, unknown>): string;
  processRefund(providerRef: string, amount: number, reason: string): Promise<RefundResult>;
}


export class JumiaAfricaAdapter implements PaymentProvider {
  readonly name = 'jumia_africa';

  get environment(): 'sandbox' | 'production' {
    return process.env.JUMIA_AFRICA_ENV === 'production' && process.env.JUMIA_AFRICA_API_KEY
      ? 'production'
      : 'sandbox';
  }

  async initiateSession(req: PaymentSessionRequest): Promise<PaymentSessionResponse> {
    if (this.environment === 'production') {
      // Refuse to fabricate a fake checkout URL with live credentials configured:
      // the official JumiaPay Africa checkout endpoint must be wired here first (EXF-501).
      throw new Error(
        'Intégration JumiaPay production non branchée : configurez JUMIA_AFRICA_ENV=sandbox tant que l’endpoint officiel de checkout n’a pas été intégré côté serveur.'
      );
    }

    const providerRef = `JAF-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();

    const checkoutUrl = `${req.returnUrl}?jumia_session=${encodeURIComponent(providerRef)}&order=${encodeURIComponent(req.orderNumber)}`;

    return {
      provider: 'jumia_africa',
      environment: this.environment,
      providerRef,
      checkoutUrl,
      expiresAt,
    };
  }

  signSandboxWebhook(payload: Record<string, unknown>): string {
    return crypto
      .createHmac('sha256', getWebhookSecret())
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): WebhookVerificationResult | null {
    if (!signatureHeader) return null;
    const expected = crypto.createHmac('sha256', getWebhookSecret()).update(rawBody).digest('hex');
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    try {
      const parsed = JSON.parse(rawBody) as {
        providerRef: string;
        status: 'paid' | 'failed' | 'cancelled' | 'refunded';
        amount: number;
      };
      if (!parsed.providerRef || !parsed.status) return null;
      return {
        valid: true,
        providerRef: parsed.providerRef,
        status: parsed.status,
        amount: Number(parsed.amount),
        rawEvent: parsed as unknown as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }

  async processRefund(providerRef: string, _amount: number, _reason: string): Promise<RefundResult> {
    if (this.environment === 'production') {
      // Never pretend a live refund succeeded: without the official JumiaPay refund endpoint
      // wired, report an explicit failure so the order is NOT marked as refunded.
      console.error(
        `[JumiaAfrica] Remboursement production refusé pour ${providerRef} : endpoint de remboursement officiel non intégré.`
      );
      return {
        success: false,
        refundRef: '',
        reason: 'Le remboursement via Jumia Africa n’est pas encore disponible en production (endpoint PSP non intégré).',
      };
    }
    return {
      success: true,
      refundRef: `REF-SANDBOX-${providerRef}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    };
  }
}

export const jumiaAfricaProvider: PaymentProvider = new JumiaAfricaAdapter();
