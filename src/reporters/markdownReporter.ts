import type { Requirements, ScenarioResult } from "../schemas";
import { writeTextFile } from "../utils/fs";

const renderJudgeLines = (result: ScenarioResult): string => {
	return result.judges
		.map((j) => {
			const base = `- ${j.phase}: pass=${String(j.pass)} score=${j.score} reasons=${j.reasons.join(" | ")}`;
			if (!j.criterionEvaluations || j.criterionEvaluations.length === 0) {
				return base;
			}
			const evalLines = j.criterionEvaluations
				.map(
					(e) =>
						`  - [${e.pass ? "pass" : "fail"}] "${e.criterion}" (confidence: ${e.confidence.toFixed(2)}): ${e.reasoning}`,
				)
				.join("\n");
			return `${base}\n${evalLines}`;
		})
		.join("\n");
};

const renderRequirementsSection = (
	result: ScenarioResult,
	requirements: Requirements | undefined,
): string => {
	const summary = result.requirementsSummary;
	if (!summary) {
		return "";
	}

	const lines: string[] = [
		"",
		"## requirements",
		`- id: ${summary.id}`,
		`- title: ${summary.title}`,
		`- loaded: ${String(summary.loaded)}`,
		`- validationStatus: ${summary.validationStatus}`,
		`- successCriteriaCount: ${summary.successCriteriaCount}`,
		`- reviewPersonasCount: ${summary.reviewPersonasCount}`,
	];

	if (requirements && summary.validationStatus === "valid") {
		lines.push("", "### task", requirements.task);

		if (requirements.constraints && requirements.constraints.length > 0) {
			lines.push("", "### constraints");
			for (const c of requirements.constraints) {
				lines.push(`- ${c}`);
			}
		}

		if (
			requirements.successCriteria &&
			requirements.successCriteria.length > 0
		) {
			lines.push("", "### successCriteria");
			for (const sc of requirements.successCriteria) {
				lines.push(`- ${sc}`);
			}
		}

		if (requirements.reviewPersonas && requirements.reviewPersonas.length > 0) {
			lines.push("", "### reviewPersonas");
			for (const persona of requirements.reviewPersonas) {
				const role = persona.role ? ` (${persona.role})` : "";
				lines.push(
					`- **${persona.name}**${role}: focus=${persona.focus.join(", ")}`,
				);
			}
		}
	}

	return lines.join("\n");
};

const renderPersonaReviewsSection = (result: ScenarioResult): string => {
	if (result.personaReviews.length === 0) return "";

	const lines = ["", "## persona reviews"];
	for (const review of result.personaReviews) {
		const role = review.personaRole ? ` (${review.personaRole})` : "";
		lines.push(
			`### ${review.personaName}${role}`,
			`- pass: ${String(review.pass)}`,
			`- feedback: ${review.feedback}`,
		);
	}
	return lines.join("\n");
};

const renderRevisionSuggestionsSection = (result: ScenarioResult): string => {
	if (result.revisionSuggestions.length === 0) return "";

	const lines = ["", "## revision suggestions"];
	for (const s of result.revisionSuggestions) {
		lines.push(`- ${s}`);
	}
	return lines.join("\n");
};

export const writeMarkdownReport = async (
	path: string,
	result: ScenarioResult,
	requirements?: Requirements,
): Promise<void> => {
	const content = [
		`# llmharness report`,
		"",
		`- scenarioId: ${result.scenarioId}`,
		`- finalDecision: ${result.finalDecision}`,
		`- durationMs: ${result.durationMs}`,
		"",
		"## judges",
		renderJudgeLines(result),
		renderRequirementsSection(result, requirements),
		renderPersonaReviewsSection(result),
		renderRevisionSuggestionsSection(result),
		"",
	].join("\n");

	await writeTextFile(path, content);
};
