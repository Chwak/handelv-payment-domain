import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

const PAYMENTS_TABLE_NAME = process.env.PAYMENTS_TABLE_NAME || '';
const OUTBOX_TABLE_NAME = process.env.OUTBOX_TABLE_NAME || '';
const IDEMPOTENCY_TABLE_NAME = process.env.IDEMPOTENCY_TABLE_NAME || '';

interface OrderCreatedEvent {
  orderId: string;
  collectorUserId: string;
  makerUserIds: string[];
  totalAmount: number;
  currency: string;
  items: Array<{
    shelfItemId: string;
    quantity: number;
    unitPrice: number;
    makerUserId: string;
  }>;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  subtotal: number;
  shippingCost: number;
  taxAmount: number;
  timestamp: string;
}

interface PaymentRecord {
  paymentId: string;
  orderId: string;
  collectorUserId: string;
  makerUserIds: string[];
  amount: number;
  currency: string;
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
  paymentMethod?: string;
  processor?: string;
  externalPaymentId?: string;
  createdAt: number;
  authorizedAt?: number;
  capturedAt?: number;
  refundedAt?: number;
  failureReason?: string;
}

const dynamodbClient = new DynamoDBClient({});
const dynamodbDoc = DynamoDBDocumentClient.from(dynamodbClient);

export const handler = async (event: SQSEvent): Promise<{
  batchItemFailures: Array<{ itemIdentifier: string }>;
}> => {
  console.log('========== ORDER CREATED CONSUMER START (Payment Domain) ==========');

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  if (!PAYMENTS_TABLE_NAME) {
    console.error('PAYMENTS_TABLE_NAME not set');
    throw new Error('Internal server error');
  }

  if (!OUTBOX_TABLE_NAME) {
    console.error('OUTBOX_TABLE_NAME not set');
    throw new Error('Internal server error');
  }

  for (const record of event.Records || []) {
    const messageId = record.messageId || 'unknown';
    try {
      console.log(`\n---------- Processing Record: ${messageId} ----------`);

      if (!record.body) {
        throw new Error('Empty SQS message body');
      }

      // Parse SQS message (wrapped EventBridge event)
      let eventBridgeEnvelope;
      try {
        eventBridgeEnvelope = JSON.parse(record.body);
      } catch (e) {
        console.error('Failed to parse SQS body as JSON', { messageId });
        throw e;
      }

      const detail = eventBridgeEnvelope.detail as OrderCreatedEvent;
      if (!detail) {
        throw new Error('Missing detail in EventBridge envelope');
      }

      const { orderId, collectorUserId, makerUserIds, totalAmount, currency, timestamp } = detail;

      // Validate required fields
      if (!orderId || !collectorUserId || !totalAmount || !currency) {
        throw new Error(
          `Missing required fields: orderId=${orderId}, collectorUserId=${collectorUserId}, ` +
          `totalAmount=${totalAmount}, currency=${currency}`
        );
      }

      console.log('Processing order event', { orderId });

      // Check idempotency (if table exists)
      if (IDEMPOTENCY_TABLE_NAME) {
        try {
          const idempotencyKey = orderId;
          const idempotencyResult = await dynamodbDoc.send(
            new GetCommand({
              TableName: IDEMPOTENCY_TABLE_NAME,
              Key: { id: idempotencyKey },
            })
          );

          if (idempotencyResult.Item) {
            console.log(`Payment already created for orderId=${orderId}, skipping`);
            continue;
          }
        } catch (err) {
          console.warn('Failed to check idempotency, proceeding anyway', { err });
        }
      }

      // Create payment record
      const paymentId = `payment-${randomUUID()}`;
      const now = Date.now();

      const payment: PaymentRecord = {
        paymentId,
        orderId,
        collectorUserId,
        makerUserIds: makerUserIds || [],
        amount: totalAmount,
        currency,
        status: 'PENDING',
        createdAt: now,
      };

      await dynamodbDoc.send(
        new PutCommand({
          TableName: PAYMENTS_TABLE_NAME,
          Item: payment,
        })
      );

      console.log(`Payment created: paymentId=${paymentId}, orderId=${orderId}`);

      // Record idempotency if table exists
      if (IDEMPOTENCY_TABLE_NAME) {
        try {
          await dynamodbDoc.send(
            new PutCommand({
              TableName: IDEMPOTENCY_TABLE_NAME,
              Item: {
                id: orderId,
                paymentId,
                createdAt: now,
                expiresAt: Math.floor(now / 1000) + (7 * 24 * 60 * 60), // ✅ CRITICAL FIX: 7 days (was 24h)
              },
            })
          );
        } catch (err) {
          console.warn('Failed to record idempotency', { err });
          // Non-fatal, continue anyway
        }
      }

      // Queue payment.initiated.v1 event
      try {
        console.log('Queueing payment.initiated.v1 event...');
        const initiatedEventId = randomUUID();
        const initiatedPayload = {
          paymentId,
          orderId,
          collectorUserId,
          makerUserIds,
          amount: totalAmount,
          currency,
          status: 'PENDING',
          timestamp: new Date().toISOString(),
        };

        await dynamodbDoc.send(
          new PutCommand({
            TableName: OUTBOX_TABLE_NAME,
            Item: {
              eventId: initiatedEventId,
              eventType: 'payment.initiated.v1',
              eventVersion: 1,
              correlationId: orderId,
              payload: JSON.stringify(initiatedPayload),
              status: 'PENDING',
              createdAt: new Date().toISOString(),
              retries: 0,
              expiresAt: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // ✅ CRITICAL FIX: 7 days
            },
          })
        );

        console.log('Queued payment.initiated.v1 event');
      } catch (err) {
        console.error('Failed to queue payment.initiated.v1 event', { err });
        throw err;
      }

      // Simulate payment authorization (in production, call Stripe/Square/etc)
      // For MVP: Auto-approve payments
      console.log('Simulating payment authorization (MVP: auto-approve)...');

      const authorizedAt = Date.now();

      await dynamodbDoc.send(
        new UpdateCommand({
          TableName: PAYMENTS_TABLE_NAME,
          Key: { paymentId },
          UpdateExpression: 'SET #status = :status, authorizedAt = :authorizedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'AUTHORIZED',
            ':authorizedAt': authorizedAt,
          },
        })
      );

      console.log(`Payment authorized: paymentId=${paymentId}`);

      // Capture payment (auto-capture in MVP)
      const capturedAt = Date.now();

      await dynamodbDoc.send(
        new UpdateCommand({
          TableName: PAYMENTS_TABLE_NAME,
          Key: { paymentId },
          UpdateExpression: 'SET #status = :status, capturedAt = :capturedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'CAPTURED',
            ':capturedAt': capturedAt,
          },
        })
      );

      console.log(`Payment captured: paymentId=${paymentId}`);

      // Queue payment.captured.v1 event (triggers Order Domain)
      try {
        console.log('Queueing payment.captured.v1 event...');
        const capturedEventId = randomUUID();
        const capturedPayload = {
          paymentId,
          orderId,
          collectorUserId,
          amount: totalAmount,
          currency,
          status: 'CAPTURED',
          capturedAt: new Date(capturedAt).toISOString(),
          timestamp: new Date().toISOString(),
        };

        await dynamodbDoc.send(
          new PutCommand({
            TableName: OUTBOX_TABLE_NAME,
            Item: {
              eventId: capturedEventId,
              eventType: 'payment.captured.v1',
              eventVersion: 1,
              correlationId: orderId,
              payload: JSON.stringify(capturedPayload),
              status: 'PENDING',
              createdAt: new Date().toISOString(),
              retries: 0,
              expiresAt: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // ✅ CRITICAL FIX: 7 days
            },
          })
        );

        console.log('Queued payment.captured.v1 event');
      } catch (err) {
        console.error('Failed to queue payment.captured.v1 event', { err });
        throw err;
      }

      console.log(`✅ Order processed successfully: orderId=${orderId}, paymentId=${paymentId}`);
    } catch (err) {
      console.error(`❌ Error processing record ${messageId}:`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId || messageId });
    }
  }

  console.log('========== ORDER CREATED CONSUMER END ==========');
  console.log(`Processed ${event.Records?.length || 0} records, ${batchItemFailures.length} failures`);

  return { batchItemFailures };
};
