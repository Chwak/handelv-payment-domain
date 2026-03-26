import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface PaymentApiGatewayConstructProps {
  environment: string;
  regionCode: string;
  createPaymentLambda?: lambda.IFunction;
  authorizePaymentLambda?: lambda.IFunction;
  capturePaymentLambda?: lambda.IFunction;
  createRefundLambda?: lambda.IFunction;
  getPaymentLambda?: lambda.IFunction;
  listPaymentMethodsLambda?: lambda.IFunction;
  addPaymentMethodLambda?: lambda.IFunction;
  paymentWebhookLambda?: lambda.IFunction;
}

export class PaymentApiGatewayConstruct extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: PaymentApiGatewayConstructProps) {
    super(scope, id);

    // Import User Pool from SSM (created by auth-essentials stack)
    const userPoolId = ssm.StringParameter.fromStringParameterName(
      this,
      'UserPoolId',
      `/${props.environment}/auth-essentials/cognito/user-pool-id`
    ).stringValue;

    const userPool = cognito.UserPool.fromUserPoolId(
      this,
      'ImportedUserPool',
      userPoolId
    );

    // Create API Gateway for payment operations
    this.api = new apigateway.RestApi(this, 'PaymentApi', {
      restApiName: `${props.environment}-${props.regionCode}-payment-domain-api`,
      description: 'Payment API for Hand-Made Platform',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['http://localhost:3000', 'https://localhost:3000'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: true,
      },
    });

    this.apiUrl = this.api.url;

    // Cognito authorizer is the primary authorizer in all domains except auth.
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // ===== PAYMENT ENDPOINTS =====

    // POST /payments - Create payment (requires auth)
    if (props.createPaymentLambda) {
      const paymentsResource = this.api.root.addResource('payments');
      const createPaymentIntegration = new apigateway.LambdaIntegration(props.createPaymentLambda);

      paymentsResource.addMethod('POST', createPaymentIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer: cognitoAuthorizer,
      });
    }

    // POST /payments/{paymentId}/authorize - Authorize payment (requires auth)
    if (props.authorizePaymentLambda) {
      let paymentsResource = this.api.root.getResource('payments');
      if (!paymentsResource) {
        paymentsResource = this.api.root.addResource('payments');
      }
      const paymentIdResource = paymentsResource.addResource('{paymentId}');
      const authorizeResource = paymentIdResource.addResource('authorize');
      const authorizeIntegration = new apigateway.LambdaIntegration(props.authorizePaymentLambda);

      authorizeResource.addMethod('POST', authorizeIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer: cognitoAuthorizer,
      });
    }

    // POST /payments/{paymentId}/capture - Capture payment (requires auth)
    if (props.capturePaymentLambda) {
      const paymentsResource = this.api.root.getResource('payments');
      if (paymentsResource) {
        const paymentIdResource = paymentsResource.getResource('{paymentId}');
        if (paymentIdResource) {
          const captureResource = paymentIdResource.addResource('capture');
          const captureIntegration = new apigateway.LambdaIntegration(props.capturePaymentLambda);

          captureResource.addMethod('POST', captureIntegration, {
            authorizationType: apigateway.AuthorizationType.COGNITO,
            authorizer: cognitoAuthorizer,
          });
        }
      }
    }

    // POST /payments/{paymentId}/refunds - Create refund (requires auth)
    if (props.createRefundLambda) {
      const paymentsResource = this.api.root.getResource('payments');
      if (paymentsResource) {
        const paymentIdResource = paymentsResource.getResource('{paymentId}');
        if (paymentIdResource) {
          const refundsResource = paymentIdResource.addResource('refunds');
          const createRefundIntegration = new apigateway.LambdaIntegration(props.createRefundLambda);

          refundsResource.addMethod('POST', createRefundIntegration, {
            authorizationType: apigateway.AuthorizationType.COGNITO,
            authorizer: cognitoAuthorizer,
          });
        }
      }
    }

    // GET /payments/{paymentId} - Get payment (requires auth)
    if (props.getPaymentLambda) {
      const paymentsResource = this.api.root.getResource('payments');
      if (paymentsResource) {
        const paymentIdResource = paymentsResource.getResource('{paymentId}');
        if (paymentIdResource) {
          const getPaymentIntegration = new apigateway.LambdaIntegration(props.getPaymentLambda);

          paymentIdResource.addMethod('GET', getPaymentIntegration, {
            authorizationType: apigateway.AuthorizationType.COGNITO,
            authorizer: cognitoAuthorizer,
          });
        }
      }
    }

    // GET /payments - List payments (requires auth)
    if (props.getPaymentLambda) {
      const paymentsResource = this.api.root.getResource('payments');
      if (paymentsResource) {
        const listPaymentsIntegration = new apigateway.LambdaIntegration(props.getPaymentLambda);

        paymentsResource.addMethod('GET', listPaymentsIntegration, {
          authorizationType: apigateway.AuthorizationType.COGNITO,
          authorizer: cognitoAuthorizer,
        });
      }
    }

    // ===== PAYMENT METHODS ENDPOINTS =====

    // GET /payment-methods - List payment methods (requires auth)
    if (props.listPaymentMethodsLambda) {
      const paymentMethodsResource = this.api.root.addResource('payment-methods');
      const listPaymentMethodsIntegration = new apigateway.LambdaIntegration(props.listPaymentMethodsLambda);

      paymentMethodsResource.addMethod('GET', listPaymentMethodsIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer: cognitoAuthorizer,
      });
    }

    // POST /payment-methods - Add payment method (requires auth)
    if (props.addPaymentMethodLambda) {
      const paymentMethodsResource = this.api.root.getResource('payment-methods');
      if (paymentMethodsResource) {
        const addPaymentMethodIntegration = new apigateway.LambdaIntegration(props.addPaymentMethodLambda);

        paymentMethodsResource.addMethod('POST', addPaymentMethodIntegration, {
          authorizationType: apigateway.AuthorizationType.COGNITO,
          authorizer: cognitoAuthorizer,
        });
      }
    }

    // ===== WEBHOOK ENDPOINTS =====

    // POST /webhooks/payment - Payment publisher webhook (public, but should validate signature)
    if (props.paymentWebhookLambda) {
      const webhooksResource = this.api.root.addResource('webhooks');
      const paymentWebhookResource = webhooksResource.addResource('payment');
      const webhookIntegration = new apigateway.LambdaIntegration(props.paymentWebhookLambda);

      paymentWebhookResource.addMethod('POST', webhookIntegration, {
        authorizationType: apigateway.AuthorizationType.NONE,
      });
    }

    // Grant Lambda functions permission to be invoked by API Gateway
    const lambdaFunctions = [
      props.createPaymentLambda,
      props.authorizePaymentLambda,
      props.capturePaymentLambda,
      props.createRefundLambda,
      props.getPaymentLambda,
      props.listPaymentMethodsLambda,
      props.addPaymentMethodLambda,
      props.paymentWebhookLambda,
    ].filter(fn => fn !== undefined);

    lambdaFunctions.forEach(lambdaFn => {
      if (lambdaFn) {
        lambdaFn.addPermission(`${lambdaFn.node.id}ApiGatewayPermission`, {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          action: 'lambda:InvokeFunction',
          sourceArn: this.api.arnForExecuteApi('*', '/*', '*'),
        });
      }
    });

    // Export API URL to SSM
    new ssm.StringParameter(this, 'PaymentApiUrlParameter', {
      parameterName: `/${props.environment}/payment-domain/apigateway/api-url`,
      stringValue: this.apiUrl,
      description: 'Payment Domain API Gateway REST API URL',
    });

    new cdk.CfnOutput(this, 'PaymentApiUrl', {
      value: this.apiUrl,
      description: 'Payment Domain API Gateway REST API URL',
      exportName: `${props.environment}-${props.regionCode}-payment-domain-api-url`,
    });
  }
}
