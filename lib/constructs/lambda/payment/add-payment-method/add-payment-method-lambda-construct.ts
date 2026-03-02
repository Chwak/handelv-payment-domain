import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface AddPaymentMethodLambdaConstructProps {
  environment: string;
  regionCode: string;
  paymentMethodsTable: dynamodb.ITable;
  removalPolicy?: cdk.RemovalPolicy;
}

export class AddPaymentMethodLambdaConstruct extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: AddPaymentMethodLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'AddPaymentMethodLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-payment-domain-add-payment-method-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Add Payment Method Lambda',
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
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-add-payment-method-lambda*`,
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:PutItem'],
              resources: [props.paymentMethodsTable.tableArn],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'AddPaymentMethodLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-add-payment-method-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/payment/add-payment-method');
    this.function = new lambda.Function(this, 'AddPaymentMethodFunction', {
      functionName: `${props.environment}-${props.regionCode}-payment-domain-add-payment-method-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'add-payment-method-lambda.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      role,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.DISABLED,
      logGroup,
      environment: {
        ENVIRONMENT: props.environment,
        REGION_CODE: props.regionCode,
        PAYMENT_METHODS_TABLE_NAME: props.paymentMethodsTable.tableName,
        LOG_LEVEL: props.environment === 'prod' ? 'ERROR' : 'INFO',
      },
      description: 'Add payment method for a user',
    });

    props.paymentMethodsTable.grantWriteData(this.function);


    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}
