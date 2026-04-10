import { loadHarnessConfig } from "../config/loadConfig";
import { createRunPaths } from "../reporterPaths";
import { writeJsonReport } from "../reporters/jsonReporter";
import { writeMarkdownReport } from "../reporters/markdownReporter";
import { writeSarifReport } from "../reporters/sarifReporter";
import {
	loadScenarioById,
	loadScenariosBySuite,
} from "../scenarios/loadScenario";
import type { ScenarioSuite } from "../schemas";
import { runPipeline } from "./pipeline";

export const runSingleScenario = async (
	scenarioId: string,
	configPath?: string,
): Promise<string> => {
	const config = await loadHarnessConfig(configPath);
	const scenario = await loadScenarioById(scenarioId);
	const result = await runPipeline(scenario, config);

	const paths = await createRunPaths(config.artifactsDir);
	result.artifacts.push(
		{ kind: "report", path: paths.reportJsonPath },
		{ kind: "report", path: paths.reportMarkdownPath },
		{ kind: "report", path: paths.reportSarifPath },
	);

	await writeJsonReport(paths.reportJsonPath, result);
	await writeMarkdownReport(paths.reportMarkdownPath, result);
	await writeSarifReport(paths.reportSarifPath, result);

	return paths.runDir;
};

export const runSuite = async (
	suite: ScenarioSuite,
	configPath?: string,
): Promise<string[]> => {
	const config = await loadHarnessConfig(configPath);
	const scenarios = await loadScenariosBySuite(suite);
	const runDirs: string[] = [];

	for (const scenario of scenarios) {
		const result = await runPipeline(scenario, config);
		const paths = await createRunPaths(config.artifactsDir);
		result.artifacts.push(
			{ kind: "report", path: paths.reportJsonPath },
			{ kind: "report", path: paths.reportMarkdownPath },
			{ kind: "report", path: paths.reportSarifPath },
		);

		await writeJsonReport(paths.reportJsonPath, result);
		await writeMarkdownReport(paths.reportMarkdownPath, result);
		await writeSarifReport(paths.reportSarifPath, result);

		runDirs.push(paths.runDir);
	}

	return runDirs;
};
