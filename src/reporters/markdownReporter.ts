import type { ScenarioResult } from "../schemas";
import { writeTextFile } from "../utils/fs";

const renderJudgeLines = (result: ScenarioResult): string => {
	return result.judges
		.map(
			(j) =>
				`- ${j.phase}: pass=${String(j.pass)} score=${j.score} reasons=${j.reasons.join(" | ")}`,
		)
		.join("\n");
};

export const writeMarkdownReport = async (
	path: string,
	result: ScenarioResult,
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
		"",
	].join("\n");

	await writeTextFile(path, content);
};
