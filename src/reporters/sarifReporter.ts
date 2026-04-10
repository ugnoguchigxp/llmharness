import type { RiskFinding, ScenarioResult } from "../schemas";
import { writeJsonFile } from "../utils/fs";

const toSarifLevel = (
	level: RiskFinding["level"],
): "error" | "warning" | "note" => {
	if (level === "error") {
		return "error";
	}
	if (level === "warn") {
		return "warning";
	}
	return "note";
};

export const writeSarifReport = async (
	path: string,
	result: ScenarioResult,
): Promise<void> => {
	const findings = result.risk?.findings ?? [];
	const sarif = {
		$schema: "https://json.schemastore.org/sarif-2.1.0.json",
		version: "2.1.0",
		runs: [
			{
				tool: {
					driver: {
						name: "llmharness",
						version: "0.1.0",
					},
				},
				results: findings.map((f) => ({
					ruleId: f.ruleId ?? f.id,
					level: toSarifLevel(f.level),
					message: { text: f.message },
					locations: f.file
						? [
								{
									physicalLocation: {
										artifactLocation: {
											uri: f.file,
										},
									},
								},
							]
						: undefined,
				})),
			},
		],
	};

	await writeJsonFile(path, sarif);
};
