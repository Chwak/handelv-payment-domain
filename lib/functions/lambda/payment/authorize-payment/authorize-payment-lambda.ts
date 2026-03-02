import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
  initTelemetryLogger(event, { domain: "payment-domain", service: "authorize-payment" });
  const traceparent = resolveTraceparent(event);
  if (!PAYMENTS_TABLE) throw new Error('Internal server error');

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
  if ((payment.status as string) !== 'PENDING') {
    return apiResponse(409, { message: 'Payment cannot be authorized' });
  }

  const now = new Date().toISOString();
  const updateResult = await client.send(
    new UpdateCommand({
      TableName: PAYMENTS_TABLE,
      Key: { paymentId },
      UpdateExpression: 'SET #st = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':status': 'AUTHORIZED', ':now': now },
      ReturnValues: 'ALL_NEW',
    })
  );

  return apiResponse(200, updateResult.Attributes ?? payment);
};