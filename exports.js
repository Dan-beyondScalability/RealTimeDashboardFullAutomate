var assert = require('assert');
var AWS = require('aws-sdk');
var http = require('http');


exports.createAnalytics = (event, context, callback) => {

    function notifyCodepipeline() {
        var codepipeline = new AWS.CodePipeline();
        var jobId = event["CodePipeline.job"].id;
        var putJobSuccess = function(message) {
            var params = {
                jobId: jobId
            };
            codepipeline.putJobSuccessResult(params, function(err, data) {
                if(err) {
                    context.fail(err);      
                } else {
                    context.succeed(message);      
                }
            });
        };
        putJobSuccess("Tests passed.");
    }




    function startApplication() {
        var params = {
            ApplicationName: 'counter',
            InputConfigurations: [
                {
                    Id: '1.1',
                    InputStartingPositionConfiguration: {
                        InputStartingPosition: 'NOW'
                    }
                }
            ]
        };
        var kinesisanalytics = new AWS.KinesisAnalytics();
        kinesisanalytics.startApplication(params, function (err, data) {
            if (err) console.log(err, err.stack);
            else notifyCodepipeline();
        });
    }

    function createApplication(arn) {
        //get AccountID
        var regex = /arn:aws:iam::([0-9]+)/g;
        var match = regex.exec(arn);
        var userId = match[1];

        var analyticsIamRoleArn = "arn:aws:iam::" + userId + ":role/service-role/KinesisAnalyticsRole"
        var kinesisStreamArn = "arn:aws:kinesis:eu-west-1:" + userId + ":stream/GatherStream"
        var firehoseArn = "arn:aws:firehose:eu-west-1:" + userId + ":deliverystream/DeliveryStream"

        var AWS = require("aws-sdk");
        AWS.config.region = 'eu-west-1';
        var kinesisanalytics = new AWS.KinesisAnalytics();

        var params = {
            ApplicationName: 'counter',
            ApplicationCode: `CREATE OR REPLACE STREAM "DESTINATION_SQL_STREAM" ("eventCategory" VARCHAR(50),"eventType" VARCHAR(50), "occurrenceCount" INTEGER, "TimeStamp" TimeStamp);

                                CREATE OR REPLACE  PUMP "STREAM_PUMP" AS 
                                INSERT INTO "DESTINATION_SQL_STREAM"
                                SELECT STREAM "eventCategory", "eventType",SUM("occurrenceCount") as "occurrenceCount", ROWTIME as "TimeStamp"
                                FROM "SOURCE_SQL_STREAM_001"
                                GROUP BY "eventCategory","eventType", FLOOR(("SOURCE_SQL_STREAM_001".ROWTIME - TIMESTAMP '1970-01-01 00:00:00') SECOND / 10 TO SECOND);`,
            Inputs: [
                {
                    InputSchema: {
                        RecordColumns: [
                            {
                                Name: 'occurrenceCount',
                                SqlType: 'TINYINT',
                                Mapping: '$.occurrenceCount'
                            },
                            {
                                Name: 'eventCategory',
                                SqlType: 'VARCHAR(50)',
                                Mapping: '$.eventCategory'
                            },
                            {
                                Name: 'eventType',
                                SqlType: 'VARCHAR(50)',
                                Mapping: '$.eventType'
                            }
                        ],
                        RecordFormat: {
                            RecordFormatType: 'JSON'
                        }
                    },
                    NamePrefix: 'SOURCE_SQL_STREAM',
                    KinesisStreamsInput: {
                        ResourceARN: kinesisStreamArn,
                        RoleARN: analyticsIamRoleArn
                    }
                }
            ],
            Outputs: [
                {
                    DestinationSchema: {
                        RecordFormatType: 'JSON'
                    },
                    Name: 'DESTINATION_SQL_STREAM',
                    KinesisFirehoseOutput: {
                        ResourceARN: firehoseArn,
                        RoleARN: analyticsIamRoleArn
                    }
                }
            ]
        };
        kinesisanalytics.createApplication(params, function (err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            else startApplication();
        });
    }

    AWS.config.region = 'eu-west-1';
    var params = {
        RoleName: 'LambdaRole'
    };

    var iam = new AWS.IAM();
    iam.getRole(params, function (err, data) {
        if (err) console.log(err, err.stack);
        else createApplication(data.Role.Arn);
    });
};

exports.startProxy = (event, context, callback) => {
    var command='bundle install --deployment && bundle exec ./proxy.rb'
    runCommand(event,command);
};

exports.createESindex = (event, context, callback) => {
    var command=`curl -XPOST localhost:8080/simplecounter -d '{
    "mappings" : {
        "counter" : {
            "properties": {
				"TimeStamp":    { "type": "date",    "doc_values": true ,"format": "yyyy-MM-dd HH:mm:ss.SSS"},
				"eventCategory":         { "type": "string" },
				"eventType":         { "type": "string", "doc_values": true, "index": "no" },
				"occurrenceCount":         { "type": "integer", "doc_values": true, "index": "no" }
			}
        }
    }
}'`
    runCommand(event,command);
};
    
function runCommand(event,command){

    function notifyCodepipeline() {
        var codepipeline = new AWS.CodePipeline();
        var jobId = event["CodePipeline.job"].id;
        var putJobSuccess = function (message) {
            var params = {
                jobId: jobId
            };
            codepipeline.putJobSuccessResult(params, function (err, data) {
                if (err) {
                    context.fail(err);
                } else {
                    context.succeed(message);
                }
            });
        };
        putJobSuccess("Tests passed.");
    }

    function startProxy(id) {
        var ssm = new AWS.SSM();
        var params = {
            DocumentName: 'AWS-RunShellScript',
            InstanceIds: [
                id,
            ],
            Parameters: {
                commands: [
                    command
                ],
                workingDirectory: [
                    '/home/ubuntu/aws-signing-proxy'
                ]
            },
            TimeoutSeconds: 600
        };
        ssm.sendCommand(params, function (err, data) {
            if (err) console.log(err, err.stack);
            else notifyCodepipeline();
        });
    }

    function findEc2() {
        var ec2 = new AWS.EC2();
        var params = {
            Filters: [
                {
                    Name: 'tag:Name',
                    Values: [
                        'Dashboard'
                    ]
                }
            ]
        };

        ec2.describeInstances(params, function (err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            else startProxy(data.Reservations[0].Instances[0].InstanceId);
        });
    }

    findEc2();
};