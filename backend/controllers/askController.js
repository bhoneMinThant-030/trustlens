const { getMockLambdaResponse } = require("../services/lambdaService");
const { checkTrustStatus } = require("../services/trustService");
const askQuestion = (req, res) => {
    const { emailId, question } = req.body;

    if (
        typeof question !== "string" ||
        question.trim() === ""
    ) {
        return res.status(400).json({
            error: {
                code: "BAD_REQUEST",
                message: "Please enter a valid question."
            }
        });
    }

    if (
        typeof emailId !== "string" ||
        emailId.trim() === ""
    ) {
        return res.status(400).json({
            error: {
                code: "BAD_REQUEST",
                message: "Please provide a valid emailId."
            }
        });
    }

    // Temporary IDs for testing
    const questionId = "q_123";
    const answerId = "a_123";

    // Get the mock AI response
    const lambdaResponse = getMockLambdaResponse(questionId, question);
    const reviewTrigger = checkTrustStatus(lambdaResponse);

    const review = reviewTrigger
        ? {
            status: "pending",
            trigger: reviewTrigger,
            reviewId: "r_045"
        }
        : null;

    // Return the AI response to the frontend
    res.json({
        questionId: questionId,
        answerId: answerId,
        emailId: emailId,
        type: lambdaResponse.type,
        answer: lambdaResponse.answer,
        category: lambdaResponse.category,
        confidence: lambdaResponse.confidence,
        claims: lambdaResponse.claims,
        sources: lambdaResponse.sources,
        review: review
    });
};

module.exports = { askQuestion };