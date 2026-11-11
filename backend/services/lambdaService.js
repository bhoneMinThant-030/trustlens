
const {
    LambdaClient,
    InvokeCommand
} = require("@aws-sdk/client-lambda");

const lambdaClient = new LambdaClient({
    region: process.env.AWS_REGION || "ap-southeast-2"
});

function getMockLambdaResponse(requestId, question) {
    return {
        requestId: requestId,
        type: "generated",
        answer: "The annual fee is waived for the first year.",
        category: "fees-charges",
        confidence: 0.67,
        safetyTextAltered: false,

        claims: [
            {
                id: "c1",
                text: "The annual fee is waived for the first year.",
                label: "supported",
                sourceId: "card-fees@2026.1#3",
                outdated: false,
                reason: "Matches the fee schedule."
            },
            {
                id: "c2",
                text: "The fee may be waived after the first year.",
                label: "insufficient_evidence",
                sourceId: null,
                outdated: false,
                reason: "No supporting passage was found."
            }
        ],

        sources: [
            {
                id: "card-fees@2026.1#3",
                docId: "card-fees",
                title: "Credit card fees and charges",
                version: "2026.1",
                effectiveDate: "2026-03-01",
                authority: "official",
                category: "fees-charges",
                excerpt: "The annual fee is waived for the first year ...",
                url: "https://www.ocbc.com/"
            }
        ]
    };
}


async function invokeLambda(requestId, question) {
    // Keep mock mode for testing
    if (process.env.USE_MOCK_LAMBDA !== "false") {
        return getMockLambdaResponse(requestId, question);
    }

    try {
        const command = new InvokeCommand({
            FunctionName:
                process.env.LAMBDA_FUNCTION_NAME || "trustlens-ai",
            InvocationType: "RequestResponse",
            Payload: Buffer.from(
                JSON.stringify({
                    requestId,
                    question
                })
            )
        });

        const result = await lambdaClient.send(command);

        // AWS Lambda may return a function-level error
        if (result.FunctionError) {
            throw new Error("Lambda execution failed.");
        }

        // Decode and parse the Lambda response
        const responseText = Buffer.from(
            result.Payload || []
        ).toString("utf-8");

        const response = JSON.parse(responseText);

        // Lambda may return a handled error
        if (response.error) {
            throw new Error(
                response.error.message || "Lambda returned an error."
            );
        }

        return response;

    } catch (error) {
        console.error("Lambda invocation failed:", error.message);

        const lambdaError = new Error("AI service is unavailable.");
        lambdaError.status = 502;
        lambdaError.code = "LAMBDA_FAILED";

        throw lambdaError;
    }
}

module.exports = {
    getMockLambdaResponse,
    invokeLambda
};