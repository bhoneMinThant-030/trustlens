const { randomUUID } = require("crypto");
const { db } = require("../db");

function saveAskResult({
    questionId,
    answerId,
    emailId,
    question,
    lambdaResponse,
    reviewTrigger
}) {
    const createdAt = new Date().toISOString();

    // Start transaction
    const saveTransaction = db.transaction(() => {

        // Prevent duplicate answers for the same email
        const existingAnswer = db.prepare(`
            SELECT a.id
            FROM answers a
            JOIN questions q ON a.question_id = q.id
            WHERE q.email_id = ?
            LIMIT 1
        `).get(emailId);

        if (existingAnswer) {
            throw new Error("ANSWER_ALREADY_EXISTS");
        }

        // STEP 1: Find an existing question for this email
        const existingQuestion = db.prepare(`
            SELECT id
            FROM questions
            WHERE email_id = ?
            LIMIT 1
        `).get(emailId);

        let savedQuestionId = questionId;

        if (existingQuestion) {
            // Reuse the existing question
            savedQuestionId = existingQuestion.id;
        } else {
            // Create a question only for a new email
            const insertQuestion = db.prepare(`
                INSERT INTO questions (
                    id,
                    email_id,
                    category,
                    question,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?)
            `);

            insertQuestion.run(
                questionId,
                emailId,
                lambdaResponse.category || "uncategorised",
                question,
                createdAt
            );
        }

        // STEP 2: Save answer
        const insertAnswer = db.prepare(`
        INSERT INTO answers (
            id,
            question_id,
            type,
            answer,
            category,
            confidence,
            safety_text_altered,
            status,
            claims,
            sources,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const answerStatus = reviewTrigger
            ? "pending_review"
            : "approved";

        insertAnswer.run(
            answerId,
            savedQuestionId,
            lambdaResponse.type,
            lambdaResponse.answer,
            lambdaResponse.category || "uncategorised",
            lambdaResponse.confidence ?? null,
            lambdaResponse.safetyTextAltered === true ? 1 : 0,
            answerStatus,
            JSON.stringify(lambdaResponse.claims || []),
            JSON.stringify(lambdaResponse.sources || []),
            createdAt,
            createdAt
        );

        // STEP 3: Save individual claims
        const insertClaim = db.prepare(`
        INSERT INTO claims (
            id,
            answer_id,
            sentence,
            status,
            source_id,
            quote,
            outdated,
            reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

        for (const claim of lambdaResponse.claims || []) {
            const claimId = `c_${randomUUID()}`;

            insertClaim.run(
                claimId,
                answerId,
                claim.text,
                claim.label,
                claim.sourceId ?? null,
                claim.quote ?? null,
                claim.outdated === true ? 1 : 0,
                claim.reason ?? null
            );
        }

        // STEP 4: Save review if required
        let review = null;

        if (reviewTrigger) {
            const reviewId = `r_${randomUUID()}`;

            const insertReview = db.prepare(`
                INSERT INTO reviews (
                    id,
                    question_id,
                    answer_id,
                    trigger,
                    status,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            insertReview.run(
                reviewId,
                savedQuestionId,
                answerId,
                reviewTrigger,
                "pending",
                createdAt
            );

            review = {
                reviewId: reviewId,
                status: "pending",
                trigger: reviewTrigger
            };
        }

        // Return review information
        return {
            questionId: savedQuestionId,
            answerId: answerId,
            review: review
        };
    });

    // Execute transaction
    return saveTransaction();
}

module.exports = { saveAskResult };