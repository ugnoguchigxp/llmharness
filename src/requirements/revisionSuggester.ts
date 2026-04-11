import type { FinalDecision, JudgeResult, Requirements } from "../schemas";
import { extractKeywords } from "./keywords";

const criterionAppearsTestable = (
	criterion: string,
	allReasons: string[],
): boolean => {
	const keywords = extractKeywords(criterion);
	if (keywords.length === 0) return false;
	const reasonText = allReasons.join(" ").toLowerCase();
	return keywords.some((kw) => reasonText.includes(kw));
};

export const generateRevisionSuggestions = (
	requirements: Requirements | undefined,
	finalDecision: FinalDecision,
	judges: JudgeResult[],
): string[] => {
	if (!requirements) return [];
	if (finalDecision === "pass") return [];

	const successCriteria = requirements.successCriteria ?? [];
	if (successCriteria.length === 0) return [];

	const allReasons = judges.flatMap((j) => j.reasons);
	const failures = judges.filter((j) => !j.pass).flatMap((j) => j.reasons);

	const suggestions: string[] = [];

	const untestable = successCriteria.filter(
		(c) => !criterionAppearsTestable(c, allReasons),
	);
	if (untestable.length > 0) {
		const list = untestable.map((c) => `"${c}"`).join(", ");
		suggestions.push(
			`successCriteria with no matching judge signal (consider linking to mustPassTests): ${list}`,
		);
	}

	if (
		failures.length > 0 &&
		requirements.constraints &&
		requirements.constraints.length > 0
	) {
		const constraintKeywords =
			requirements.constraints.flatMap(extractKeywords);
		const conflicting = failures.filter((reason) =>
			constraintKeywords.some((kw) => reason.toLowerCase().includes(kw)),
		);
		if (conflicting.length > 0) {
			const list = conflicting.map((r) => `"${r}"`).join(", ");
			suggestions.push(
				`failure reasons overlap with constraint keywords — consider revising constraints or expectations: ${list}`,
			);
		}
	}

	if (suggestions.length === 0) {
		suggestions.push(
			"Scenario failed but no specific revision signal found. Review successCriteria alignment with pipeline judges.",
		);
	}

	return suggestions;
};
