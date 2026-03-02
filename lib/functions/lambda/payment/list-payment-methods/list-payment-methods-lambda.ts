import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { getUserIdFromApiGatewayEvent, validateLimit } from '../../../../utils/payment-validation';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";

const PAYMENT_METHODS_TABLE = process.env.PAYMENT_METHODS_TABLE_NAME;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type ApiGatewayEvent = {
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
  initTelemetryLogger(event, { domain: "payment-domain", service: "list-payment-methods" });
  if (!PAYMENT_METHODS_TABLE) throw new Error('Internal server error');

  const userId = getUserIdFromApiGatewayEvent(event);
  if (!userId) return apiResponse(401, { message: 'Not authenticated' });

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

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const queryInput: Record<string, unknown> = {
    TableName: PAYMENT_METHODS_TABLE,
    KeyConditionExpression: 'userId = :uid',
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