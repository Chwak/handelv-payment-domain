import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import * as crypto from 'crypto';

const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE_NAME;
const REFUNDS_TABLE = process.env.REFUNDS_TABLE_NAME;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const WEBHOOK_MAX_AGE_SECONDS = Number(process.env.WEBHOOK_MAX_AGE_SECONDS || '300');

type ApiGatewayEvent = { body?: string | null; headers?: Record<string, string> };

function apiResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseBody(body: string | null | undefined): Record<string, unknown> {
  if (!body || typeof body !== 'string') return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getHeader(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

function normalizeSignature(signature: string): string {
  const trimmed = signature.trim();
  const parts = trimmed.split('=');
  return parts.length === 2 ? parts[1] : trimmed;
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const computed = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  const normalized = normalizeSignature(signature);
  if (computed.length !== normalized.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(normalized));
}

function isFreshTimestamp(raw: string | null, maxAgeSeconds: number): boolean {
  if (!raw) return true;
  const numeric = Number(raw.trim());
  if (!Number.isFinite(numeric)) return false;

  const timestampSeconds = numeric > 10_000_000_000
    ? Math.floor(numeric / 1000)
    : Math.floor(numeric);
  const nowSeconds = Math.floor(Date.now() / 1000);

  return Math.abs(nowSeconds - timestampSeconds) <= maxAgeSeconds;
}

export const handler = async (event: ApiGatewayEvent) => {
  initTelemetryLogger(event, { domain: "payment-domain", service: "payment-webhook" });
  if (!PAYMENTS_TABLE || !REFUNDS_TABLE) throw new Error('Internal server error');
  if (!WEBHOOK_SECRET) {
    console.error('WEBHOOK_SECRET not configured');
    return apiResponse(500, { message: 'Webhook not configured' });
  }

  const signature =
    getHeader(event.headers, 'x-payment-signature') ||
    getHeader(event.headers, 'x-webhook-signature');
  const timestamp =
    getHeader(event.headers, 'x-payment-timestamp') ||
    getHeader(event.headers, 'x-webhook-timestamp');
  if (!event.body || !signature || !verifySignature(event.body, signature, WEBHOOK_SECRET)) {
    return apiResponse(401, { message: 'Invalid signature' });
  }
  if (!isFreshTimestamp(timestamp, WEBHOOK_MAX_AGE_SECONDS)) {
    return apiResponse(401, { message: 'Stale webhook timestamp' });
  }

  const payload = parseBody(event.body);
  const paymentId = typeof payload.paymentId === 'string' ? payload.paymentId.trim() : null;
  const eventType = typeof payload.eventType === 'string' ? payload.eventType.trim().toUpperCase() : null;
  const status = typeof payload.status === 'string' ? payload.status.trim().toUpperCase() : null;

  if (!paymentId) return apiResponse(400, { message: 'Invalid payload: paymentId required' });

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const getResult = await client.send(
    new GetCommand({
      TableName: PAYMENTS_TABLE,
      Key: { paymentId },
    })
  );
  const payment = getResult.Item as Record<string, unknown> | undefined;
  if (!payment) return apiResponse(404, { message: 'Payment not found' });

  const now = new Date().toISOString();

  if (eventType === 'REFUND' || (status && status.includes('REFUND'))) {
    const refundId = (payload.refundId as string) ?? `ref-${Date.now()}`;
    await client.send(
      new PutCommand({
        TableName: REFUNDS_TABLE,
        Item: {
          paymentId,
          refundId,
          amount: payload.amount ?? payment.amount,
          status: (payload.refundStatus as string) ?? 'COMPLETED',
          createdAt: now,
        },
      })
    );
  }

  if (status && ['AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELED'].includes(status)) {
    await client.send(
      new UpdateCommand({
        TableName: PAYMENTS_TABLE,
        Key: { paymentId },
        UpdateExpression: 'SET #st = :status, updatedAt = :now',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':status': status, ':now': now },
      })
    );
  }

  return apiResponse(200, { received: true, paymentId });
};