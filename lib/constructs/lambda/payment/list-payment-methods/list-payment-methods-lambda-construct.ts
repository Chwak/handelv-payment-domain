import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ListPaymentMethodsLambdaConstructProps {
  environment: string;
  regionCode: string;
  paymentMethodsTable: dynamodb.ITable;
  removalPolicy?: cdk.RemovalPolicy;
}

export class ListPaymentMethodsLambdaConstruct extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: ListPaymentMethodsLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'ListPaymentMethodsLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-payment-domain-list-payment-methods-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for List Payment Methods Lambda',
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
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-list-payment-methods-lambda*`,
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:Query'],
              resources: [
                props.paymentMethodsTable.tableArn,
                `${props.paymentMethodsTable.tableArn}/index/*`,
              ],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'ListPaymentMethodsLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-payment-domain-list-payment-methods-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/payment/list-payment-methods/list-payment-methods-lambda.ts');
    this.function = new NodejsFunction(this, 'ListPaymentMethodsFunction', {
      functionName: `${props.environment}-${props.regionCode}-payment-domain-list-payment-methods-lambda`,
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
        PAYMENT_METHODS_TABLE_NAME: props.paymentMethodsTable.tableName,
        LOG_LEVEL: props.environment === 'prod' ? 'ERROR' : 'INFO',
      },
      description: 'List payment methods for a user',
    });

    props.paymentMethodsTable.grantReadData(this.function);


    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}
