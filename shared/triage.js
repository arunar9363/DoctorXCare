export const MIN_QUESTIONS = 10;
export const MAX_QUESTIONS = 15;

export const WARNING_SIGNS = [
  "Severe difficulty breathing or choking",
  "Persistent chest pain or pressure",
  "Sudden facial droop, weakness on one side, or trouble speaking",
  "Heavy bleeding that will not stop",
  "Loss of consciousness or inability to wake someone",
  "Throat swelling or difficulty breathing during an allergic reaction",
];

export const CARE_GUIDANCE = {
  emergency_ambulance: {
    label: "Get emergency help now",
    action: "Call your local emergency number now and follow the dispatcher’s instructions.",
  },
  consultation_24: {
    label: "Seek medical advice today",
    action: "Contact a healthcare professional or urgent care service today. If an urgent warning sign develops, call your local emergency number.",
  },
  consultation: {
    label: "Arrange a medical consultation",
    action: "Make an appointment to discuss these symptoms. Seek help sooner if they worsen or new concerns develop.",
  },
  self_care: {
    label: "Monitor symptoms",
    action: "Keep track of your symptoms. Contact a healthcare professional if they persist, worsen, or worry you.",
  },
};

export const SEX_LABELS = {
  female: "Female",
  male: "Male",
  intersex: "Intersex",
  unspecified: "Prefer not to say",
};

export function emergencyAssessment(id, answered, rationale = "An urgent warning sign was reported.") {
  return {
    id,
    source: "urgent_warning",
    completedAt: new Date().toISOString(),
    answered,
    triageLevel: "emergency_ambulance",
    summary: "The symptoms reported may require emergency attention.",
    rationale,
    findings: [],
    conditions: [],
    limitations: "Emergency services can assess the situation and guide your next steps.",
  };
}
