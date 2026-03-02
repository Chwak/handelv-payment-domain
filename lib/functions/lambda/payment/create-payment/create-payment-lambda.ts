import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { getUserIdFromApiGatewayEvent } from '../../../../utils/payment-validation';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";

function resolveTraceparent(event: { headers?: Record<string, string> }): string {
  const headerTraceparent = event.headers?.traceparent || event.headers?.Traceparent;
  const isValid = headerTraceparent && /^\d{2}-[0-9a-f]{32}-[0-9a-f]{16}-\d{2}$/i.test(headerTraceparent);
  if (isValid) return headerTraceparent;
  const traceId = randomUUID().replace(/-/g, '');
  const spanId = randomUUID().replace(/-/g, '').slice(0, 16);
  return `00-${traceId}-${spanId}-01`;
}

const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE_NAME;

type ApiGatewayEvent = {
  body?: string | null;
  requestContext?: { authorizer?: { claims?: { sub?: string } } };
  headers?: Record<string, string>;
};

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

export const handler = async (event: ApiGatewayEvent) => {
  initTelemetryLogger(event, { domain: "payment-domain", service: "create-payment" });
  const traceparent = resolveTraceparent(event);
  if (!PAYMENTS_TABLE) throw new Error('Internal server error');

  const userId = getUserIdFromApiGatewayEvent(event);
  if (!userId) return apiResponse(401, { message: 'Not authenticated' });

  const input = parseBody(event.body);
  const orderId = typeof input.orderId === 'string' ? input.orderId.trim() : null;
  const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount);
  const currency = typeof input.currency === 'string' ? input.currency.trim() : 'USD';

  if (!orderId || !Number.isFinite(amount) || amount <= 0) {
    return apiResponse(400, { message: 'Invalid input: orderId and positive amount required' });
  }

  const now = new Date().toISOString();
  const paymentId = randomUUID();
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  await client.send(
    new PutCommand({
      TableName: PAYMENTS_TABLE,
      Item: {
        paymentId,
        orderId,
        collectorUserId: userId,
        amount,
        currency,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      },
    })
  );

  return apiResponse(201, {
    paymentId,
    orderId,
    collectorUserId: userId,
    amount,
    currency,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
  });
};