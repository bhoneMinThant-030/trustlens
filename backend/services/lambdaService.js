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

module.exports = { getMockLambdaResponse };