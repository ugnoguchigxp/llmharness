import { cp, mkdir, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
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
import type {
	HarnessConfig,
	RequirementsSummary,
	ScenarioInput,
	ScenarioSuite,
} from "../schemas";
import { indexScenarioRun } from "../storage/runIndex";
import { exists } from "../utils/fs";
import { runPipeline } from "./pipeline";

const ALL_SUITES: ScenarioSuite[] = ["smoke", "regression", "edge-cases"];

export type ScenarioRunResult = {
	runDir: string;
	scenarioId: string;
	requirementsSummary?: RequirementsSummary;
};

const isWithinDirectory = (root: string, path: string): boolean =>
	path === root || path.startsWith(`${root}/`);

const copyWorkspaceForSuiteRun = async (
	sourceWorkspaceRoot: string,
	destinationWorkspaceRoot: string,
	artifactsDir: string,
): Promise<void> => {
	const sourceRoot = resolve(sourceWorkspaceRoot);
	const destinationRoot = resolve(destinationWorkspaceRoot);
	const artifactsRoot = resolve(artifactsDir);
	const gitRoot = resolve(sourceRoot, ".git");
	const nodeModulesSource = resolve(sourceRoot, "node_modules");
	const nodeModulesDestination = resolve(destinationRoot, "node_modules");
	const excludeArtifacts = isWithinDirectory(sourceRoot, artifactsRoot);

	await mkdir(destinationRoot, { recursive: true });
	await cp(sourceRoot, destinationRoot, {
		recursive: true,
		force: true,
		filter: (src) => {
			const absolute = resolve(String(src));
			if (isWithinDirectory(destinationRoot, absolute)) return false;
			if (isWithinDirectory(gitRoot, absolute)) return false;
			if (isWithinDirectory(nodeModulesSource, absolute)) return false;
			if (excludeArtifacts && isWithinDirectory(artifactsRoot, absolute))
				return false;
			return true;
		},
	});

	if (await exists(nodeModulesSource)) {
		try {
			await symlink(nodeModulesSource, nodeModulesDestination, "dir");
		} catch {
			await cp(nodeModulesSource, nodeModulesDestination, {
				recursive: true,
				force: true,
			});
		}
	}
};

const runScenarioAndWriteReports = async (
	scenario: ScenarioInput,
	config: HarnessConfig,
	runDir: string,
	requirementsPathOverride?: string,
): Promise<RequirementsSummary | undefined> => {
	const effectivePath = requirementsPathOverride ?? scenario.requirementsPath;
	const reqResult = await resolveAndLoadRequirements(
		scenario.id,
		effectivePath,
	);
	const requirementsContext = toRequirementsContext(reqResult);

	const result = await runPipeline(
		scenario,
		config,
		runDir,
		requirementsContext,
		reqResult?.summary,
	);
	const reportJsonPath = join(runDir, "result.json");
	const reportMarkdownPath = join(runDir, "result.md");
	const reportSarifPath = join(runDir, "result.sarif.json");
	result.artifacts.push(
		{ kind: "report", path: reportJsonPath },
		{ kind: "report", path: reportMarkdownPath },
		{ kind: "report", path: reportSarifPath },
	);

	await writeJsonReport(reportJsonPath, result);
	await writeMarkdownReport(
		reportMarkdownPath,
		result,
		requirementsContext?.requirements,
	);
	await writeSarifReport(reportSarifPath, result);
	try {
		await indexScenarioRun({
			config,
			scenario,
			result,
			runDir,
			reportJsonPath,
			reportMarkdownPath,
			reportSarifPath,
		});
	} catch (error) {
		console.warn(
			`run index update failed for ${scenario.id}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	return result.requirementsSummary;
};

const prepareSuiteScenarioConfig = async (
	config: HarnessConfig,
	runDir: string,
	isolated: boolean,
): Promise<HarnessConfig> => {
	if (!isolated) return config;
	const isolatedWorkspaceRoot = resolve(runDir, "workspace");
	await copyWorkspaceForSuiteRun(
		config.workspaceRoot,
		isolatedWorkspaceRoot,
		config.artifactsDir,
	);
	return {
		...config,
		workspaceRoot: isolatedWorkspaceRoot,
	};
};

export const runSingleScenario = async (
	scenarioId: string,
	configPath?: string,
	requirementsPathOverride?: string,
): Promise<string> => {
	const config = await loadHarnessConfig(configPath);
	const scenario = await loadScenarioById(scenarioId);
	const paths = await createRunPaths(config.artifactsDir);
	await runScenarioAndWriteReports(
		scenario,
		config,
		paths.runDir,
		requirementsPathOverride,
	);

	return paths.runDir;
};

export const runSuite = async (
	suite: ScenarioSuite,
	configPath?: string,
): Promise<ScenarioRunResult[]> => {
	const config = await loadHarnessConfig(configPath);
	const scenarios = await loadScenariosBySuite(suite);
	const results: ScenarioRunResult[] = new Array(scenarios.length);
	const suiteConcurrency = Math.max(1, config.orchestrator.suiteConcurrency);
	const runScenario = async (
		scenario: ScenarioInput,
		isolated: boolean,
	): Promise<ScenarioRunResult> => {
		const paths = await createRunPaths(config.artifactsDir);
		const scenarioConfig = await prepareSuiteScenarioConfig(
			config,
			paths.runDir,
			isolated,
		);
		const requirementsSummary = await runScenarioAndWriteReports(
			scenario,
			scenarioConfig,
			paths.runDir,
		);
		return {
			runDir: paths.runDir,
			scenarioId: scenario.id,
			requirementsSummary,
		};
	};

	if (suiteConcurrency === 1) {
		for (const [index, scenario] of scenarios.entries()) {
			results[index] = await runScenario(scenario, false);
		}
		return results;
	}

	let nextIndex = 0;
	const workers = Array.from(
		{ length: Math.min(suiteConcurrency, scenarios.length) },
		() =>
			(async () => {
				while (true) {
					const currentIndex = nextIndex++;
					if (currentIndex >= scenarios.length) {
						return;
					}
					const scenario = scenarios[currentIndex];
					if (!scenario) {
						return;
					}
					results[currentIndex] = await runScenario(scenario, true);
				}
			})(),
	);
	await Promise.all(workers);

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
