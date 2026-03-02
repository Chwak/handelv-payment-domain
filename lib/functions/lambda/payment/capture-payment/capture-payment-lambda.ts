import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
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
const OUTBOX_TABLE_NAME = process.env.OUTBOX_TABLE_NAME;

type ApiGatewayEvent = {
  pathParameters?: { paymentId?: string } | null;
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

export const handler = async (event: ApiGatewayEvent) => {
  initTelemetryLogger(event, { domain: "payment-domain", service: "capture-payment" });
  const traceparent = resolveTraceparent(event);
  if (!PAYMENTS_TABLE || !OUTBOX_TABLE_NAME) throw new Error('Internal server error');

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
  if ((payment.status as string) !== 'AUTHORIZED') {
    return apiResponse(409, { message: 'Payment must be authorized before capture' });
  }

  const now = new Date().toISOString();
  const traceId = randomUUID().replace(/-/g, '');
  const spanId = randomUUID().replace(/-/g, '').slice(0, 16);
  const eventId = randomUUID();
  const correlationId = randomUUID();
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // ✅ CRITICAL FIX: 7 days TTL (was 24h)

  try {
    // Update payment status to CAPTURED
    const updateResult = await client.send(
      new UpdateCommand({
        TableName: PAYMENTS_TABLE,
        Key: { paymentId },
        UpdateExpression: 'SET #st = :status, updatedAt = :now',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':status': 'CAPTURED', ':now': now },
        ReturnValues: 'ALL_NEW',
      })
    );

    const capturedPayment = updateResult.Attributes ?? payment;

    // Queue payment.captured.v1 for downstream domains
    const outboxPayload = {
      paymentId,
      collectorUserId: payment.collectorUserId,
      orderId: payment.orderId, // Assuming payment has orderId link
      amount: payment.amount,
      captureTime: now,
    };

    await client.send(
      new PutCommand({
        TableName: OUTBOX_TABLE_NAME,
        Item: {
          eventId,
          eventType: 'payment.captured.v1',
          eventVersion: 1,
          correlationId,
          payload: JSON.stringify(outboxPayload),
          traceparent,
          trace_id: traceId,
          span_id: spanId,
          status: 'PENDING',
          createdAt: now,
          retries: 0,
          expiresAt: expiresAtEpoch,
        },
      })
    );

    await client.send(
      new UpdateCommand({
        TableName: PAYMENTS_TABLE,
        Key: { paymentId },
        UpdateExpression: 'SET outboxEventId = :eventId',
        ExpressionAttributeValues: { ':eventId': eventId },
      })
    );

    console.log('Payment captured and event queued:', { paymentId, eventId });

    return apiResponse(200, capturedPayment);
  } catch (err) {
    console.error('Failed to capture payment:', err);
    return apiResponse(500, { message: 'Failed to capture payment' });
  }
};