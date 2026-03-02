import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import {
  getUserIdFromApiGatewayEvent,
  validateId,
  validateLimit,
} from '../../../../utils/payment-validation';

const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE_NAME;
const GSI2_COLLECTOR = 'GSI2-CollectorUserId';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type ApiGatewayEvent = {
  pathParameters?: { paymentId?: string } | null;
  queryStringParameters?: { limit?: string; nextToken?: string } | null;
  requestContext?: { authorizer?: { claims?: { sub?: string } } };
};

function apiResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: ApiGatewayEvent) => {
  initTelemetryLogger(event, { domain: "payment-domain", service: "get-payment" });
  if (!PAYMENTS_TABLE) throw new Error('Internal server error');

  const paymentId = event.pathParameters?.paymentId;
  const userId = getUserIdFromApiGatewayEvent(event);
  if (!userId) return apiResponse(401, { message: 'Not authenticated' });

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  if (paymentId) {
    const id = validateId(paymentId);
    if (!id) return apiResponse(400, { message: 'Invalid input format' });
    const result = await client.send(
      new GetCommand({
        TableName: PAYMENTS_TABLE,
        Key: { paymentId: id },
      })
    );
    const payment = result.Item as Record<string, unknown> | undefined;
    if (!payment) return apiResponse(404, { message: 'Payment not found' });
    if ((payment.collectorUserId as string) !== userId) return apiResponse(403, { message: 'Forbidden' });
    return apiResponse(200, payment);
  }

  const limit = validateLimit(
    event.queryStringParameters?.limit != null ? parseInt(event.queryStringParameters.limit, 10) : null,
    DEFAULT_LIMIT,
    MAX_LIMIT
  );
  const nextTokenRaw = event.queryStringParameters?.nextToken?.trim();
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (nextTokenRaw) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(nextTokenRaw, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      // ignore invalid token
    }
  }

  const queryInput: Record<string, unknown> = {
    TableName: PAYMENTS_TABLE,
    IndexName: GSI2_COLLECTOR,
    KeyConditionExpression: 'collectorUserId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
    Limit: limit,
  };
  if (exclusiveStartKey) queryInput.ExclusiveStartKey = exclusiveStartKey;

  const result = await client.send(new QueryCommand(queryInput as QueryCommandInput));
  const items = (result.Items ?? []) as Record<string, unknown>[];
  const newNextToken = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey), 'utf8').toString('base64url')
    : null;

  return apiResponse(200, { items, nextToken: newNextToken });
};