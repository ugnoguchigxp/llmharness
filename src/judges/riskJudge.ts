import {
	type HarnessConfig,
	type JudgeResult,
	parseJudgeResult,
	type RiskResult,
	type ScenarioInput,
} from "../schemas";

export const runRiskJudge = (
	risk: RiskResult,
	scenario: ScenarioInput,
	config: HarnessConfig,
): JudgeResult => {
	const errorCount = risk.levelCounts.error;
	const pass = !risk.blocking && errorCount <= scenario.expected.maxRiskErrors;

	return parseJudgeResult({
		phase: "review",
		score: pass ? config.scoring.riskWeight : 0,
		pass,
		reasons: pass
			? ["Risk gate passed."]
			: [
					`Risk gate failed: errors=${errorCount}, blocking=${String(risk.blocking)}`,
				],
	});
};
