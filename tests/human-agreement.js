// Shared human-vs-judge agreement computation, used by the terminal reviewer
// (tests/human-review.js) and the browser reviewer (tests/review-server.js).
// Turns per-entry humanLabel/judgment pairs into an aggregate.

// Fraction of human/judge label pairs that agree, plus mean absolute
// difference per metric. Safety/calibration are absent on entries predating
// JUDGE_RUBRIC_VERSION v2-four-metrics, so those are averaged over however many exist.
export function computeHumanAgreement(entries) {
  const labeled = entries.filter((e) => e.humanLabel && e.judgment);
  if (labeled.length === 0) return { reviewedCount: 0 };

  let helpfulnessExact = 0, groundednessExact = 0, hallucinationAgreements = 0;
  let helpfulnessAbsDiffSum = 0, groundednessAbsDiffSum = 0;
  let safetyExact = 0, calibrationExact = 0, safetyN = 0, calibrationN = 0;
  let safetyAbsDiffSum = 0, calibrationAbsDiffSum = 0;

  for (const e of labeled) {
    const hDiff = Math.abs(e.humanLabel.helpfulness - e.judgment.helpfulness);
    const gDiff = Math.abs(e.humanLabel.groundedness - e.judgment.groundedness);
    helpfulnessAbsDiffSum += hDiff;
    groundednessAbsDiffSum += gDiff;
    if (hDiff === 0) helpfulnessExact++;
    if (gDiff === 0) groundednessExact++;

    if (e.humanLabel.safety != null && e.judgment.safety != null) {
      safetyN++;
      const sDiff = Math.abs(e.humanLabel.safety - e.judgment.safety);
      safetyAbsDiffSum += sDiff;
      if (sDiff === 0) safetyExact++;
    }
    if (e.humanLabel.calibration != null && e.judgment.calibration != null) {
      calibrationN++;
      const cDiff = Math.abs(e.humanLabel.calibration - e.judgment.calibration);
      calibrationAbsDiffSum += cDiff;
      if (cDiff === 0) calibrationExact++;
    }

    const humanFlagged = (e.humanLabel.hallucinations ?? []).length > 0;
    const judgeFlagged  = (e.judgment.hallucinations  ?? []).length > 0;
    if (humanFlagged === judgeFlagged) hallucinationAgreements++;
  }

  return {
    reviewedCount: labeled.length,
    helpfulnessExactAgreementRate:   helpfulnessExact / labeled.length,
    helpfulnessMeanAbsDiff:          helpfulnessAbsDiffSum / labeled.length,
    groundednessExactAgreementRate:  groundednessExact / labeled.length,
    groundednessMeanAbsDiff:         groundednessAbsDiffSum / labeled.length,
    safetyExactAgreementRate:       safetyN ? safetyExact / safetyN : null,
    safetyMeanAbsDiff:              safetyN ? safetyAbsDiffSum / safetyN : null,
    calibrationExactAgreementRate:  calibrationN ? calibrationExact / calibrationN : null,
    calibrationMeanAbsDiff:         calibrationN ? calibrationAbsDiffSum / calibrationN : null,
    hallucinationFlagAgreementRate:  hallucinationAgreements / labeled.length,
  };
}
