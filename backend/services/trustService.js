function checkTrustStatus(lambdaResponse) {
    const threshold = Number(
        process.env.CONFIDENCE_THRESHOLD || 0.7
    );

    // Approved answers do not require automatic review
    if (lambdaResponse.type === "approved") {
        return null;
    }

    if (lambdaResponse.confidence < threshold) {
        return "auto_threshold";
    }

    const hasContradiction = lambdaResponse.claims.some(
        claim => claim.label === "contradicted"
    );

    if (hasContradiction) {
        return "auto_contradiction";
    }

    if (lambdaResponse.safetyTextAltered === true) {
        return "auto_safety";
    }

    return null;
}

module.exports = { checkTrustStatus };