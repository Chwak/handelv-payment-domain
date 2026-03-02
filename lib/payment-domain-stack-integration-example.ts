import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { DomainStackProps } from "./domain-stack-props";
import { PaymentApiGatewayConstruct } from "./constructs/apigateway/payment-apigateway/payment-apigateway-construct";
import { PaymentStateMachineConstruct } from "./constructs/stepfunctions/payment-state-machine/payment-state-machine-construct";
import { AuthorizePaymentLambdaConstruct } from "./constructs/lambda/payment/authorize-payment/authorize-payment-lambda-construct";
import { CapturePaymentLambdaConstruct } from "./constructs/lambda/payment/capture-payment/capture-payment-lambda-construct";
// TODO: Import DynamoDB table constructs when created
// TODO: Import shared EventBridge bus when created

/**
 * Example integration showing how to wire together:
 * - API Gateway REST API
 * - Step Functions State Machine
 * - Lambda functions (invoke Step Functions)
 * - API Gateway integrations (connect Lambda to REST endpoints)
 * - DynamoDB tables
 * - EventBridge bus (shared infra)
 */
export class PaymentDomainStackIntegrationExample extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DomainStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Domain", "payment-domain");
    cdk.Tags.of(this).add("Environment", props.environment);
    cdk.Tags.of(this).add("Project", "hand-made");
    cdk.Tags.of(this).add("Region", props.regionCode);
    cdk.Tags.of(this).add("StackName", this.stackName);

    const removalPolicy = props.environment === 'prod'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // TODO: Step 1 - Create DynamoDB tables
    // const paymentsTable = new PaymentsTableConstruct(...);
    // const refundsTable = new RefundsTableConstruct(...);

    // TODO: Step 2 - Import shared EventBridge bus (from Shared Infra)
    // const eventBusName = ssm.StringParameter.fromStringParameterName(...).stringValue;
    // const eventBus = events.EventBus.fromEventBusName(...);

    // Step 3 - Create Step Functions State Machine
    // const paymentStateMachine = new PaymentStateMachineConstruct(this, "PaymentStateMachine", {
    //   environment: props.environment,
    //   regionCode: props.regionCode,
    //   paymentsTable: paymentsTable.table,
    //   refundsTable: refundsTable.table,
    //   eventBus: eventBus,
    // });

    // Step 4 - Create Lambda functions that invoke Step Functions
    // const authorizePaymentLambda = new AuthorizePaymentLambdaConstruct(this, "AuthorizePaymentLambda", {
    //   environment: props.environment,
    //   regionCode: props.regionCode,
    //   stateMachine: paymentStateMachine.stateMachine,
    //   removalPolicy,
    // });

    // const capturePaymentLambda = new CapturePaymentLambdaConstruct(this, "CapturePaymentLambda", {
    //   environment: props.environment,
    //   regionCode: props.regionCode,
    //   stateMachine: paymentStateMachine.stateMachine,
    //   removalPolicy,
    // });

    // Step 5 - Create API Gateway REST API with Lambda integrations
    const paymentApiGateway = new PaymentApiGatewayConstruct(this, "PaymentApiGateway", {
      environment: props.environment,
      regionCode: props.regionCode,
      // authorizePaymentLambda: authorizePaymentLambda.function,
      // capturePaymentLambda: capturePaymentLambda.function,
      // TODO: Add other Lambda functions when created
    });

    // TODO: Add DynamoDB tables, Lambdas, etc. per payment-data-layer
  }
}
