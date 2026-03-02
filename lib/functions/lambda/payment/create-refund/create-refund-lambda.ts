import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { getUserIdFromApiGatewayEvent, validateId } from '../../../../utils/payment-validation';
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
const REFUNDS_TABLE = process.env.REFUNDS_TABLE_NAME;

type ApiGatewayEvent = {
  pathParameters?: { paymentId?: string } | null;
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
  initTelemetryLogger(event, { domain: "payment-domain", service: "create-refund" });
  const traceparent = resolveTraceparent(event);
  if (!PAYMENTS_TABLE || !REFUNDS_TABLE) throw new Error('Internal server error');

  const paymentId = validateId(event.pathParameters?.paymentId);
  if (!paymentId) return apiResponse(400, { message: 'Invalid input format' });

  const userId = getUserIdFromApiGatewayEvent(event);
  if (!userId) return apiResponse(401, { message: 'Not authenticated' });

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const getResult = await client.send(
    new GetCommand({
      TableName: PAYMENTS_TABLE,
      Key: { paymentId },
    })
  );
  const payment = getResult.Item as Record<string, unknown> | undefined;
  if (!payment) return apiResponse(404, { message: 'Payment not found' });
  if ((payment.collectorUserId as string) !== userId) return apiResponse(403, { message: 'Forbidden' });
  const status = (payment.status as string) ?? '';
  if (status !== 'CAPTURED' && status !== 'AUTHORIZED') {
    return apiResponse(409, { message: 'Refund only allowed for captured or authorized payments' });
  }

  const input = parseBody(event.body);
  const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount);
  const paymentAmount = payment.amount as number;
  if (Number.isFinite(amount) && amount <= 0) {
    return apiResponse(400, { message: 'Invalid refund amount' });
  }
  if (Number.isFinite(amount) && amount > paymentAmount) {
    return apiResponse(400, { message: 'Refund amount exceeds payment amount' });
  }
  const refundAmount = Number.isFinite(amount) ? amount : paymentAmount;
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : null;

  const now = new Date().toISOString();
  const refundId = randomUUID();

  await client.send(
    new PutCommand({
      TableName: REFUNDS_TABLE,
      Item: {
        paymentId,
        refundId,
        amount: refundAmount,
        reason: reason ?? null,
        status: 'PENDING',
        createdAt: now,
      },
    })
  );

  return apiResponse(201, {
    paymentId,
    refundId,
    amount: refundAmount,
    reason: reason ?? null,
    status: 'PENDING',
    createdAt: now,
  });
};