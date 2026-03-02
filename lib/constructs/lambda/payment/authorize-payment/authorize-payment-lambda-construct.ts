import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface AuthorizePaymentLambdaConstructProps {
  environment: string;
  regionCode: string;
  paymentsTable: dynamodb.ITable;
  removalPolicy?: cdk.RemovalPolicy;
}

export class AuthorizePaymentLambdaConstruct extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: AuthorizePaymentLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'AuthorizePaymentLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-payment-domain-authorize-payment-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Authorize Payment Lambda',
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
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-authorize-payment-lambda*`,
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
              resources: [props.paymentsTable.tableArn],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'AuthorizePaymentLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-authorize-payment-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/payment/authorize-payment');
    this.function = new lambda.Function(this, 'AuthorizePaymentFunction', {
      functionName: `${props.environment}-${props.regionCode}-payment-domain-authorize-payment-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'authorize-payment-lambda.handler',
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
      description: 'Authorize payment in DynamoDB',
    });

    props.paymentsTable.grantReadWriteData(this.function);

    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}
