
function checkTrustStatus(lambdaResponse) {
    const threshold = Number(
        process.env.CONFIDENCE_THRESHOLD || 0.7
    );

    // Approved answers never require automatic review
    if (lambdaResponse.type === "approved") {
        return null;
    }

    // Priority 1: Safety wording changed
    if (lambdaResponse.safetyTextAltered === true) {
        return "auto_safety";
    }

    // Priority 2: Contradicted claims
    const hasContradiction = Array.isArray(lambdaResponse.claims) &&
        lambdaResponse.claims.some(
            claim => claim.label === "contradicted"
        );

    if (hasContradiction) {
        return "auto_contradiction";
    }

    // Priority 3: Low confidence
    if (
        typeof lambdaResponse.confidence === "number" &&
        lambdaResponse.confidence < threshold
    ) {
        return "auto_threshold";
    }

    return null;
}

module.exports = { checkTrustStatus };
