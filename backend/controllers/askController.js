const { randomUUID } = require("crypto");
const { invokeLambda } = require("../services/lambdaService");
const { checkTrustStatus } = require("../services/trustService");
const { getAnswerByEmailId } = require("../db");
const { saveAskResult } = require("../services/saveAskResult");

const askQuestion = async (req, res) => {
    const { emailId, question } = req.body;

    // Step 1: Validate question
    if (
        typeof question !== "string" ||
        question.trim() === "" ||
        question.length > 2000
    ) {
        return res.status(400).json({
            error: {
                code: "BAD_REQUEST",
                message: "Please enter a valid question."
            }
        });
    }

    // Step 2: Validate emailId
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

    try {
        // STEP 1: Check for an existing answer
        const existingAnswer = getAnswerByEmailId(emailId);

        if (existingAnswer) {
            return res.json(existingAnswer);
        }

        // STEP 2: Generate IDs
        const questionId = `q_${randomUUID()}`;
        const answerId = `a_${randomUUID()}`;

        // STEP 3: Call Lambda only if no answer exists
        const lambdaResponse = await invokeLambda(questionId, question);
        const reviewTrigger = checkTrustStatus(lambdaResponse);

        const savedResult = saveAskResult({
            questionId,
            answerId,
            emailId,
            question,
            lambdaResponse,
            reviewTrigger
        });
        const review = savedResult.review;

        if (review) {
            const io = req.app.get("io");

            if (io) {
                io.to("reviewers").emit("review:new", {
                    reviewId: review.reviewId,
                    questionId: savedResult.questionId,
                    answerId: savedResult.answerId,
                    emailId: emailId,
                    trigger: review.trigger,
                    status: review.status
                });
            }
        }

        // Return the AI response to the frontend
        return res.json({
            questionId: savedResult.questionId,
            answerId: savedResult.answerId,
            emailId: emailId,
            type: lambdaResponse.type,
            answer: lambdaResponse.answer,
            category: lambdaResponse.category,
            confidence: lambdaResponse.confidence,
            claims: lambdaResponse.claims,
            sources: lambdaResponse.sources,
            review: review
        });

    } catch (error) {
        console.error("Ask question failed:", error.message);

        // Lambda service error
        if (error.code === "LAMBDA_FAILED") {
            return res.status(502).json({
                error: {
                    code: "LAMBDA_FAILED",
                    message: "Unable to generate an AI answer."
                }
            });
        }

        // Another request already saved an answer
        if (error.message === "ANSWER_ALREADY_EXISTS") {
            const existingAnswer = getAnswerByEmailId(emailId);

            if (existingAnswer) {
                return res.json(existingAnswer);
            }
        }

        // Unexpected database or server error
        return res.status(500).json({
            error: {
                code: "INTERNAL_ERROR",
                message: "Unable to save or retrieve the AI answer."
            }
        });
    }
};

module.exports = { askQuestion };