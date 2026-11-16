
function checkTrustStatus(lambdaResponse) {
    const threshold = Number(
        process.env.CONFIDENCE_THRESHOLD || 0.7
    );

    // Approved answers never require automatic review
    if (lambdaResponse.type === "approved") {
        return null;
    }

    // safetyTextAltered is still returned by the Lambda but no longer routes to review:
    // the answer prompt tells the AI to copy the fixed safety sentence exactly (decided 16 Nov).

    // Priority 1: Contradicted claims
    const hasContradiction = Array.isArray(lambdaResponse.claims) &&
        lambdaResponse.claims.some(
            claim => claim.label === "contradicted"
        );

    if (hasContradiction) {
        return "auto_contradiction";
    }

    // Priority 2: Low confidence
    if (
        typeof lambdaResponse.confidence === "number" &&
        lambdaResponse.confidence < threshold
    ) {
        return "auto_threshold";
    }

    return null;
}

module.exports = { checkTrustStatus };
