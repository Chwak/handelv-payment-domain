import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import type { DomainStackProps } from "./domain-stack-props";
import { PaymentApiGatewayConstruct } from "./constructs/apigateway/payment-apigateway/payment-apigateway-construct";
import { PaymentStateMachineConstruct } from "./constructs/stepfunctions/payment-state-machine/payment-state-machine-construct";
import { PaymentTablesConstruct } from "./constructs/dynamodb/payment-tables/payment-tables-construct";
import { OutboxTableConstruct } from "./constructs/dynamodb/outbox-table/outbox-table-construct";
import { OrderCreatedConsumerLambdaConstruct } from "./constructs/lambda/event-consumer/order-created-consumer-lambda-construct";
import { importEventBusFromSharedInfra } from "./utils/eventbridge-helper";
import { RepublishLambdaConstruct } from "./constructs/lambda/republish/republish-lambda-construct";
import { AuthorizePaymentLambdaConstruct } from "./constructs/lambda/payment/authorize-payment/authorize-payment-lambda-construct";
import { CapturePaymentLambdaConstruct } from "./constructs/lambda/payment/capture-payment/capture-payment-lambda-construct";
import { CreatePaymentLambdaConstruct } from "./constructs/lambda/payment/create-payment/create-payment-lambda-construct";
import { CreateRefundLambdaConstruct } from "./constructs/lambda/payment/create-refund/create-refund-lambda-construct";
import { GetPaymentLambdaConstruct } from "./constructs/lambda/payment/get-payment/get-payment-lambda-construct";
import { ListPaymentMethodsLambdaConstruct } from "./constructs/lambda/payment/list-payment-methods/list-payment-methods-lambda-construct";
import { AddPaymentMethodLambdaConstruct } from "./constructs/lambda/payment/add-payment-method/add-payment-method-lambda-construct";
import { PaymentWebhookLambdaConstruct } from "./constructs/lambda/payment/payment-webhook/payment-webhook-lambda-construct";

export class PaymentDomainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DomainStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Domain", "hand-made-payment-domain");
    cdk.Tags.of(this).add("Environment", props.environment);
    cdk.Tags.of(this).add("Project", "hand-made");
    cdk.Tags.of(this).add("Region", props.regionCode);
    cdk.Tags.of(this).add("StackName", this.stackName);

    const removalPolicy = props.environment === 'prod'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // Step 0: Import shared EventBus
    const sharedEventBus = importEventBusFromSharedInfra(this, props.environment);
    const schemaRegistryName = ssm.StringParameter.valueForStringParameter(
      this,
      `/${props.environment}/shared-infra/glue/schema-registry-name`,
    );

    // Create idempotency table for payment event consumer
    const idempotencyTable = new dynamodb.Table(this, "PaymentIdempotencyTable", {
      tableName: `${props.environment}-${props.regionCode}-payment-idempotency`,
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "expiresAt",
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.environment === "prod" },
    });

    // Step 1: Create DynamoDB tables
    const paymentTables = new PaymentTablesConstruct(this, "PaymentTables", {
      environment: props.environment,
      regionCode: props.regionCode,
      removalPolicy,
    });

    const outboxTable = new OutboxTableConstruct(this, "OutboxTable", {
      environment: props.environment,
      regionCode: props.regionCode,
      domainName: "payment-domain",
      removalPolicy,
    });

    new RepublishLambdaConstruct(this, "RepublishLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      domainName: "payment-domain",
      outboxTable: outboxTable.table,
      eventBus: sharedEventBus,
      schemaRegistryName,
      removalPolicy,
    });

    // ========== EVENT CONSUMER: Order Created Events from Order Domain ==========
    new OrderCreatedConsumerLambdaConstruct(this, "OrderCreatedConsumer", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentsTable: paymentTables.paymentsTable,
      outboxTable: outboxTable.table,
      eventBus: sharedEventBus,
      idempotencyTable,
      removalPolicy,
    });

    // Step 2: Create Step Functions State Machine (optional; lambdas use DynamoDB directly)
    const paymentStateMachine = new PaymentStateMachineConstruct(this, "PaymentStateMachine", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentsTable: paymentTables.paymentsTable,
      refundsTable: paymentTables.refundsTable,
    });

    // Step 4: Create Lambda functions (DynamoDB-backed)
    const authorizePaymentLambda = new AuthorizePaymentLambdaConstruct(this, "AuthorizePaymentLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentsTable: paymentTables.paymentsTable,
      removalPolicy,
    });

    const capturePaymentLambda = new CapturePaymentLambdaConstruct(this, "CapturePaymentLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentsTable: paymentTables.paymentsTable,
      outboxTable: outboxTable.table,
      removalPolicy,
    });

    const createPaymentLambda = new CreatePaymentLambdaConstruct(this, "CreatePaymentLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentsTable: paymentTables.paymentsTable,
      removalPolicy,
    });

    const createRefundLambda = new CreateRefundLambdaConstruct(this, "CreateRefundLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentsTable: paymentTables.paymentsTable,
      refundsTable: paymentTables.refundsTable,
      removalPolicy,
    });

    const getPaymentLambda = new GetPaymentLambdaConstruct(this, "GetPaymentLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentsTable: paymentTables.paymentsTable,
      removalPolicy,
    });

    const listPaymentMethodsLambda = new ListPaymentMethodsLambdaConstruct(this, "ListPaymentMethodsLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentMethodsTable: paymentTables.paymentMethodsTable,
      removalPolicy,
    });

    const addPaymentMethodLambda = new AddPaymentMethodLambdaConstruct(this, "AddPaymentMethodLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentMethodsTable: paymentTables.paymentMethodsTable,
      removalPolicy,
    });

    const paymentWebhookLambda = new PaymentWebhookLambdaConstruct(this, "PaymentWebhookLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      paymentsTable: paymentTables.paymentsTable,
      refundsTable: paymentTables.refundsTable,
      removalPolicy,
    });

    // Step 5: Create API Gateway REST API with Lambda integrations
    const paymentApiGateway = new PaymentApiGatewayConstruct(this, "PaymentApiGateway", {
      environment: props.environment,
      regionCode: props.regionCode,
      authorizePaymentLambda: authorizePaymentLambda.function,
      capturePaymentLambda: capturePaymentLambda.function,
      createPaymentLambda: createPaymentLambda.function,
      createRefundLambda: createRefundLambda.function,
      getPaymentLambda: getPaymentLambda.function,
      listPaymentMethodsLambda: listPaymentMethodsLambda.function,
      addPaymentMethodLambda: addPaymentMethodLambda.function,
      paymentWebhookLambda: paymentWebhookLambda.function,
    });
  }
}
