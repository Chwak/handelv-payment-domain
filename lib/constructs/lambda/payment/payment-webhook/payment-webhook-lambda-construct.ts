import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PaymentWebhookLambdaConstructProps {
  environment: string;
  regionCode: string;
  paymentsTable: dynamodb.ITable;
  refundsTable: dynamodb.ITable;
  removalPolicy?: cdk.RemovalPolicy;
}

export class PaymentWebhookLambdaConstruct extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: PaymentWebhookLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'PaymentWebhookLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-payment-domain-payment-webhook-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Payment Webhook Lambda',
      inlinePolicies: {
        CloudWatchLogsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: [
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-payment-webhook-lambda*`,
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
              ],
              resources: [
                props.paymentsTable.tableArn,
                props.refundsTable.tableArn,
              ],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'PaymentWebhookLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-payment-webhook-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/payment/payment-webhook/payment-webhook-lambda.ts');
    this.function = new NodejsFunction(this, 'PaymentWebhookFunction', {
      functionName: `${props.environment}-${props.regionCode}-payment-domain-payment-webhook-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      entry: lambdaCodePath,
      role,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.DISABLED,
      logGroup,
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'node22',
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        ENVIRONMENT: props.environment,
        REGION_CODE: props.regionCode,
        PAYMENTS_TABLE_NAME: props.paymentsTable.tableName,
        REFUNDS_TABLE_NAME: props.refundsTable.tableName,
        LOG_LEVEL: props.environment === 'prod' ? 'ERROR' : 'INFO',
      },
      description: 'Handle payment publisher webhooks (Stripe, PayPal, etc.)',
    });

    props.paymentsTable.grantReadWriteData(this.function);
    props.refundsTable.grantReadWriteData(this.function);


    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}
