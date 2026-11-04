
/*
  This file stores sample AI verification results.

  We use mock data because the real AI backend
  is not connected yet.

  Each result belongs to a different customer email.
*/

export const mockResults = [
  {
    // First email: Annual fee enquiry
    id: 1,
    confidence: 85,
    status: "Supported",
    answer:
      "Thank you for your enquiry. Credit card annual fees may vary depending on the card type. Please refer to the latest official OCBC credit card information for the applicable fees.",
    verification: [
      "Sample answer has supporting evidence",
      "No contradiction in this mock result",
      "Human review not required",
    ],
    // Sample claims for the annual fee enquiry.
    claims: [
        
        {
        id: 1,
        text: "Credit card annual fees depend on the card type.",
        status: "Supported",
        source: "OCBC Credit Card Fees - Sample Policy",

        // This is the exact passage used to check the AI claim.
        // We are using sample evidence until the backend is connected.
        sourcePassage: "Annual fees vary depending on the credit card type."
        },
        {
            id: 2,
            text: "The applicable fee should be checked against the latest card information.",
            status: "Supported",
            source: "Sample credit card terms document"
        }
    ]
  },
  

  {
    // Second email: Cashback enquiry
    id: 2,
    confidence: 60,
    status: "Needs Review",
    answer:
      "Cashback benefits depend on the credit card type and the applicable terms and conditions.",
    verification: [
      "Some claims need more supporting evidence",
      "Cashback information needs checking",
      "Human review required"
    ],
    // Sample claims for the cashback enquiry.
    claims: [
        {
            id: 1,
            text: "Cashback benefits depend on the card type.",
            status: "Supported",
            source: "Sample cashback benefits document"
        },
        {
            id: 2,
            text: "The same cashback benefit applies to every card.",
            status: "Insufficient Evidence",
            source: null
        }
    ],
      // Sample answer returned after a human reviewer checks it.
      // This is mock data, not a real reviewer decision.
      reviewedAnswer:
          "Thank you for your enquiry. Cashback benefits and conditions depend on the specific credit card. Please refer to the latest official card terms for the applicable conditions."

  },

  {
    // Third email: Lost credit card
    id: 3,
    confidence: 40,
    status: "Needs Review",
    answer:
      "For a lost credit card, please follow OCBC's official lost-card reporting instructions. Never share your OTP.",
    verification: [
      "Important safety information needs checking",
      "Approved source evidence is incomplete",
      "Human review required"
    ],
    // Sample claims for the lost credit card enquiry.
    claims: [
        {
            id: 1,
            text: "A lost credit card should be reported using the bank's official channels.",
            status: "Supported",
            source: "Sample lost card guidance"
        },
        {
            id: 2,
            text: "The customer can safely share an OTP with someone claiming to be bank staff.",
            status: "Contradicted",
            source: "Sample OTP safety guidance"
        }
    ]
  }
];
