import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface GetPaymentLambdaConstructProps {
  environment: string;
  regionCode: string;
  paymentsTable: dynamodb.ITable;
  removalPolicy?: cdk.RemovalPolicy;
}

export class GetPaymentLambdaConstruct extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: GetPaymentLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'GetPaymentLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-payment-domain-get-payment-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Get Payment Lambda',
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
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-get-payment-lambda*`,
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:GetItem'],
              resources: [props.paymentsTable.tableArn],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'GetPaymentLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-get-payment-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/payment/get-payment');
    this.function = new lambda.Function(this, 'GetPaymentFunction', {
      functionName: `${props.environment}-${props.regionCode}-payment-domain-get-payment-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'get-payment-lambda.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      role,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.DISABLED,
      logGroup,
      environment: {
        ENVIRONMENT: props.environment,
        REGION_CODE: props.regionCode,
        PAYMENTS_TABLE_NAME: props.paymentsTable.tableName,
        LOG_LEVEL: props.environment === 'prod' ? 'ERROR' : 'INFO',
      },
      description: 'Get payment by payment ID',
    });

    props.paymentsTable.grantReadData(this.function);


    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}
