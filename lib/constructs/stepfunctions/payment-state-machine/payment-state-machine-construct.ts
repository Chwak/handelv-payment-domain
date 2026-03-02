import * as cdk from 'aws-cdk-lib';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import * as fs from 'fs';
import { Construct } from 'constructs';

export interface PaymentStateMachineConstructProps {
  environment: string;
  regionCode: string;
  paymentsTable: dynamodb.ITable;
  refundsTable: dynamodb.ITable;
}

export class PaymentStateMachineConstruct extends Construct {
  public readonly stateMachine: stepfunctions.StateMachine;
  public readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: PaymentStateMachineConstructProps) {
    super(scope, id);

    // Create CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'PaymentStateMachineLogGroup', {
      logGroupName: `/aws/stepfunctions/${props.environment}-${props.regionCode}-payment-domain-state-machine`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Read ASL JSON definition and perform substitutions
    const aslFilePath = path.join(__dirname, 'payment-state-machine.asl.json');
    let aslContent = fs.readFileSync(aslFilePath, 'utf-8');
    aslContent = aslContent.replace(/\${PaymentsTableName}/g, props.paymentsTable.tableName);
    aslContent = aslContent.replace(/\${RefundsTableName}/g, props.refundsTable.tableName);
    
    const definitionBody = stepfunctions.DefinitionBody.fromString(aslContent);

    // Create Express Step Functions state machine
    this.stateMachine = new stepfunctions.StateMachine(this, 'PaymentStateMachine', {
      stateMachineName: `${props.environment}-${props.regionCode}-payment-domain-state-machine`,
      definitionBody: definitionBody,
      stateMachineType: stepfunctions.StateMachineType.EXPRESS,
      timeout: cdk.Duration.minutes(5),
      tracingEnabled: false,
      logs: {
        destination: logGroup,
        level: stepfunctions.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    this.stateMachineArn = this.stateMachine.stateMachineArn;

    // Grant permissions
    props.paymentsTable.grantReadWriteData(this.stateMachine);
    props.refundsTable.grantReadWriteData(this.stateMachine);

    // Export to SSM
    new ssm.StringParameter(this, 'PaymentStateMachineArnParameter', {
      parameterName: `/${props.environment}/payment-domain/stepfunctions/state-machine-arn`,
      stringValue: this.stateMachineArn,
      description: 'Payment Domain Step Functions State Machine ARN',
    });

    new cdk.CfnOutput(this, 'PaymentStateMachineArn', {
      value: this.stateMachineArn,
      description: 'Payment Domain Step Functions State Machine ARN',
      exportName: `${props.environment}-${props.regionCode}-payment-domain-state-machine-arn`,
    });
  }
}
