import { loadHarnessConfig } from "../config/loadConfig";
import { createRunPaths } from "../reporterPaths";
import { writeJsonReport } from "../reporters/jsonReporter";
import { writeMarkdownReport } from "../reporters/markdownReporter";
import { writeSarifReport } from "../reporters/sarifReporter";
import {
	resolveAndLoadRequirements,
	toRequirementsContext,
} from "../requirements/loadRequirements";
import {
	loadScenarioById,
	loadScenariosBySuite,
} from "../scenarios/loadScenario";
import type { RequirementsSummary, ScenarioSuite } from "../schemas";
import { runPipeline } from "./pipeline";

const ALL_SUITES: ScenarioSuite[] = ["smoke", "regression", "edge-cases"];

export type ScenarioRunResult = {
	runDir: string;
	scenarioId: string;
	requirementsSummary?: RequirementsSummary;
};

export const runSingleScenario = async (
	scenarioId: string,
	configPath?: string,
	requirementsPathOverride?: string,
): Promise<string> => {
	const config = await loadHarnessConfig(configPath);
	const scenario = await loadScenarioById(scenarioId);
	const paths = await createRunPaths(config.artifactsDir);

	const effectivePath = requirementsPathOverride ?? scenario.requirementsPath;
	const reqResult = await resolveAndLoadRequirements(
		scenario.id,
		effectivePath,
	);
	const requirementsContext = toRequirementsContext(reqResult);

	const result = await runPipeline(
		scenario,
		config,
		paths.runDir,
		requirementsContext,
		reqResult?.summary,
	);

	result.artifacts.push(
		{ kind: "report", path: paths.reportJsonPath },
		{ kind: "report", path: paths.reportMarkdownPath },
		{ kind: "report", path: paths.reportSarifPath },
	);

	await writeJsonReport(paths.reportJsonPath, result);
	await writeMarkdownReport(
		paths.reportMarkdownPath,
		result,
		requirementsContext?.requirements,
	);
	await writeSarifReport(paths.reportSarifPath, result);

	return paths.runDir;
};

export const runSuite = async (
	suite: ScenarioSuite,
	configPath?: string,
): Promise<ScenarioRunResult[]> => {
	const config = await loadHarnessConfig(configPath);
	const scenarios = await loadScenariosBySuite(suite);
	const results: ScenarioRunResult[] = [];

	for (const scenario of scenarios) {
		const paths = await createRunPaths(config.artifactsDir);

		const reqResult = await resolveAndLoadRequirements(
			scenario.id,
			scenario.requirementsPath,
		);
		const requirementsContext = toRequirementsContext(reqResult);

		const result = await runPipeline(
			scenario,
			config,
			paths.runDir,
			requirementsContext,
			reqResult?.summary,
		);
		result.artifacts.push(
			{ kind: "report", path: paths.reportJsonPath },
			{ kind: "report", path: paths.reportMarkdownPath },
			{ kind: "report", path: paths.reportSarifPath },
		);

		await writeJsonReport(paths.reportJsonPath, result);
		await writeMarkdownReport(
			paths.reportMarkdownPath,
			result,
			requirementsContext?.requirements,
		);
		await writeSarifReport(paths.reportSarifPath, result);

		results.push({
			runDir: paths.runDir,
			scenarioId: scenario.id,
			requirementsSummary: result.requirementsSummary,
		});
	}

	return results;
};

export const runAllSuites = async (
	configPath?: string,
): Promise<ScenarioRunResult[]> => {
	const allResults: ScenarioRunResult[] = [];
	for (const suite of ALL_SUITES) {
		const suiteResults = await runSuite(suite, configPath);
		allResults.push(...suiteResults);
	}
	return allResults;
};
