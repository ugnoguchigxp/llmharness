import { extractKeywords } from "../requirements/keywords";
import type { JudgeResult, Requirements } from "../schemas";
import { parseJudgeResult } from "../schemas";

const criterionCoveredByReasons = (
	criterion: string,
	allReasons: string[],
): boolean => {
	const keywords = extractKeywords(criterion);
	if (keywords.length === 0) return false;
	const reasonText = allReasons.join(" ").toLowerCase();
	return keywords.some((kw) => reasonText.includes(kw));
};

export const runRequirementsJudge = (
	requirements: Requirements | undefined,
	judges: JudgeResult[],
): JudgeResult => {
	if (!requirements) {
		return parseJudgeResult({
			phase: "requirements",
			score: 0,
			pass: true,
			reasons: ["No requirements defined; requirements judge skipped."],
		});
	}

	const successCriteria = requirements.successCriteria ?? [];

	if (successCriteria.length === 0) {
		return parseJudgeResult({
			phase: "requirements",
			score: 100,
			pass: true,
			reasons: [
				`Requirements '${requirements.title}' loaded; no successCriteria to evaluate.`,
			],
		});
	}

	const allReasons = judges.flatMap((j) => j.reasons);

	const coverage = successCriteria.map((criterion) => ({
		criterion,
		covered: criterionCoveredByReasons(criterion, allReasons),
	}));

	const coveredCount = coverage.filter((c) => c.covered).length;
	const score = Math.round((coveredCount / successCriteria.length) * 100);
	const pass = score >= 50;

	const reasons = [
		`successCriteria coverage: ${coveredCount}/${successCriteria.length} matched`,
		...coverage.map(
			(c) => `${c.covered ? "[matched]" : "[unmatched]"} ${c.criterion}`,
		),
	];

	return parseJudgeResult({ phase: "requirements", score, pass, reasons });
};
