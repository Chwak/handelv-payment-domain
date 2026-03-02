import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface PaymentTablesConstructProps {
  environment: string;
  regionCode: string;
  removalPolicy?: cdk.RemovalPolicy;
}

export class PaymentTablesConstruct extends Construct {
  public readonly paymentsTable: dynamodb.Table;
  public readonly refundsTable: dynamodb.Table;
  public readonly paymentMethodsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: PaymentTablesConstructProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.DESTROY;

    // Payments Table
    this.paymentsTable = new dynamodb.Table(this, 'PaymentsTable', {
      tableName: `${props.environment}-${props.regionCode}-payment-domain-payments-table`,
      partitionKey: {
        name: 'paymentId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.environment === 'prod' },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI: payments by order
    this.paymentsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1-OrderId',
      partitionKey: {
        name: 'orderId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI: payments by collector
    this.paymentsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2-CollectorUserId',
      partitionKey: {
        name: 'collectorUserId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI: payments by status
    this.paymentsTable.addGlobalSecondaryIndex({
      indexName: 'GSI3-Status',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Refunds Table
    this.refundsTable = new dynamodb.Table(this, 'RefundsTable', {
      tableName: `${props.environment}-${props.regionCode}-payment-domain-refunds-table`,
      partitionKey: {
        name: 'paymentId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'refundId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.environment === 'prod' },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Payment Methods Table
    this.paymentMethodsTable = new dynamodb.Table(this, 'PaymentMethodsTable', {
      tableName: `${props.environment}-${props.regionCode}-payment-domain-payment-methods-table`,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'paymentMethodId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.environment === 'prod' },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });
  }
}
