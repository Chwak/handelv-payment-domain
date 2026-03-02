import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { getUserIdFromApiGatewayEvent } from '../../../../utils/payment-validation';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";

type ApiGatewayEvent = {
  body?: string | null;
  requestContext?: { authorizer?: { claims?: { sub?: string } } };
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
  initTelemetryLogger(event, { domain: "payment-domain", service: "add-payment-method" });
  if (!process.env.PAYMENT_METHODS_TABLE_NAME) throw new Error('Internal server error');

  const userId = getUserIdFromApiGatewayEvent(event);
  if (!userId) return apiResponse(401, { message: 'Not authenticated' });

  const input = parseBody(event.body);
  const type = typeof input.type === 'string' ? input.type.trim() : '';
  const last4 = typeof input.last4 === 'string' ? input.last4.replace(/\D/g, '').slice(-4) : '';
  const brand = typeof input.brand === 'string' ? input.brand.trim().slice(0, 50) : '';

  if (!type || type.length > 50) return apiResponse(400, { message: 'Invalid input format' });

  const now = new Date().toISOString();
  const paymentMethodId = randomUUID();
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  await client.send(
    new PutCommand({
      TableName: process.env.PAYMENT_METHODS_TABLE_NAME,
      Item: {
        userId,
        paymentMethodId,
        type,
        last4: last4 || null,
        brand: brand || null,
        createdAt: now,
        updatedAt: now,
      },
    })
  );

  return apiResponse(201, {
    userId,
    paymentMethodId,
    type,
    last4: last4 || null,
    brand: brand || null,
    createdAt: now,
    updatedAt: now,
  });
};