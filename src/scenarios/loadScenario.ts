import { join, resolve } from "node:path";
import {
	parseScenarioInput,
	type ScenarioInput,
	type ScenarioSuite,
} from "../schemas";
import { exists, listJsonFilesRecursive, readJsonFile } from "../utils/fs";

const SCENARIOS_ROOT = "scenarios";

const parseScenarioFile = async (filePath: string): Promise<ScenarioInput> => {
	const raw = await readJsonFile(filePath);
	return parseScenarioInput(raw);
};

export const loadScenarioById = async (
	scenarioId: string,
): Promise<ScenarioInput> => {
	const rootDir = resolve(SCENARIOS_ROOT);
	const candidates = [
		join(rootDir, "smoke", `${scenarioId}.json`),
		join(rootDir, "regression", `${scenarioId}.json`),
		join(rootDir, "edge-cases", `${scenarioId}.json`),
	];

	for (const filePath of candidates) {
		if (await exists(filePath)) {
			const scenario = await parseScenarioFile(filePath);
			if (scenario.id !== scenarioId) {
				throw new Error(
					`Scenario id mismatch: expected ${scenarioId}, got ${scenario.id} (${filePath})`,
				);
			}
			return scenario;
		}
	}

	throw new Error(`Scenario not found: ${scenarioId}`);
};

export const loadScenariosBySuite = async (
	suite: ScenarioSuite,
): Promise<ScenarioInput[]> => {
	const suiteDir = resolve(SCENARIOS_ROOT, suite);
	const files = await listJsonFilesRecursive(suiteDir);
	const scenarios = await Promise.all(
		files.map((filePath) => parseScenarioFile(filePath)),
	);
	return scenarios.sort((a, b) => a.id.localeCompare(b.id));
};
