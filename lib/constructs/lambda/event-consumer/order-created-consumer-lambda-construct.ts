import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodeJs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

export interface OrderCreatedConsumerLambdaConstructProps {
  environment: string;
  regionCode: string;
  paymentsTable: dynamodb.ITable;
  outboxTable: dynamodb.ITable;
  eventBus: events.IEventBus;
  idempotencyTable?: dynamodb.ITable;
  removalPolicy?: RemovalPolicy;
}

export class OrderCreatedConsumerLambdaConstruct extends Construct {
  public readonly function: lambda.IFunction;
  public readonly queue: sqs.IQueue;
  public readonly deadLetterQueue: sqs.IQueue;

  constructor(scope: Construct, id: string, props: OrderCreatedConsumerLambdaConstructProps) {
    super(scope, id);

    // Dead Letter Queue for failed event processing
    this.deadLetterQueue = new sqs.Queue(this, 'OrderCreatedConsumerDLQ', {
      queueName: `${props.environment}-${props.regionCode}-payment-order-created-consumer-dlq`,
      retentionPeriod: Duration.days(14),
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
    });

    // Main queue for order events from EventBridge
    this.queue = new sqs.Queue(this, 'OrderCreatedConsumerQueue', {
      queueName: `${props.environment}-${props.regionCode}-payment-order-created-consumer-queue`,
      visibilityTimeout: Duration.seconds(180), // 3x Lambda timeout
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3, // Retry 3 times before DLQ
      },
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
    });

    // Lambda function to process order.created events and initiate payment
    this.function = new lambdaNodeJs.NodejsFunction(this, 'OrderCreatedConsumerFunction', {
      functionName: `${props.environment}-${props.regionCode}-payment-order-created-consumer`,
      entry: `${__dirname}/../../../../functions/lambda/event-consumer/order-created-consumer-lambda.ts`,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: {
        PAYMENTS_TABLE_NAME: props.paymentsTable.tableName,
        OUTBOX_TABLE_NAME: props.outboxTable.tableName,
        IDEMPOTENCY_TABLE_NAME: props.idempotencyTable?.tableName || '',
        ENVIRONMENT: props.environment,
        REGION_CODE: props.regionCode,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        minify: false,
        sourceMap: false,
      },
    });

    // CloudWatch Log Group
    new logs.LogGroup(this, 'OrderCreatedConsumerLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-payment-order-created-consumer`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
    });

    // Grant DynamoDB permissions
    props.paymentsTable.grantReadWriteData(this.function);
    props.outboxTable.grantReadWriteData(this.function);
    if (props.idempotencyTable) {
      props.idempotencyTable.grantReadWriteData(this.function);
    }

    // Grant EventBridge permissions
    props.eventBus.grantPutEventsTo(this.function);

    // Connect Lambda to SQS event source
    this.function.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
        maxBatchingWindow: Duration.seconds(5),
      })
    );

    // Wire EventBridge rule to send order.created.v1 events to the SQS queue
    const orderCreatedRule = new events.Rule(this, 'OrderCreatedRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['hand-made.order-domain'],
        detailType: ['order.created.v1'],
      },
      description: 'Route order.created.v1 events to Payment Domain',
    });

    orderCreatedRule.addTarget(new targets.SqsQueue(this.queue));
  }
}
