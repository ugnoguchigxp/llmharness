import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadHarnessConfig } from "./config/loadConfig";
import { runDoctor, summarizeDoctor } from "./doctor";
import {
	runAllSuites,
	runSingleScenario,
	runSuite,
} from "./runner/scenarioRunner";
import {
	parseScenarioResult,
	type ScenarioSuite,
	ScenarioSuiteSchema,
} from "./schemas";
import { MemoryService } from "./services/memoryService";
import { parseArgv } from "./utils/argv";
import { runCommand as execCommand } from "./utils/exec";
import { tryParseJson } from "./utils/json";

const printHelp = (): void => {
	console.log(
		`llmharness commands:\n  run --scenario <id> [--config <path>]\n  eval --suite <smoke|regression|edge-cases|all> [--config <path>]\n  report --latest [--config <path>]\n  doctor [--config <path>]\n  commit-memory [--config <path>]`,
	);
};

const assertStringFlag = (
	flags: Record<string, string | boolean>,
	name: string,
): string => {
	const value = flags[name];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`--${name} is required`);
	}
	return value;
};

const getOptionalConfigPath = (
	flags: Record<string, string | boolean>,
): string | undefined => {
	const value = flags.config;
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}
	return value;
};

const getOptionalStringFlag = (
	flags: Record<string, string | boolean>,
	name: string,
): string | undefined => {
	const value = flags[name];
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}
	return value;
};

const isTruthyFlag = (value: string | boolean | undefined): boolean => {
	return value === true || value === "true" || value === "1";
};

const runCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const scenarioId = assertStringFlag(flags, "scenario");
	const configPath = getOptionalConfigPath(flags);
	const runDir = await runSingleScenario(scenarioId, configPath);
	console.log(`run completed: ${runDir}`);
};

const evalCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const suiteArg = assertStringFlag(flags, "suite");
	const configPath = getOptionalConfigPath(flags);
	const runDirs =
		suiteArg === "all"
			? await runAllSuites(configPath)
			: await runSuite(
					ScenarioSuiteSchema.parse(suiteArg) as ScenarioSuite,
					configPath,
				);
	console.log(`eval completed: ${runDirs.length} scenario(s)`);
	for (const dir of runDirs) {
		console.log(`- ${dir}`);
	}
};

const reportLatest = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const configPath = getOptionalConfigPath(flags);
	const config = await loadHarnessConfig(configPath);
	const root = resolve(config.artifactsDir);
	const dirs = await readdir(root, { withFileTypes: true });
	const runIds = dirs
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort((a, b) => b.localeCompare(a));

	if (runIds.length === 0) {
		throw new Error(`No runs found under ${root}`);
	}

	const latest = runIds[0];
	if (!latest) {
		throw new Error("Failed to resolve latest run");
	}
	console.log(join(root, latest));
};

const doctorCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const configPath = getOptionalConfigPath(flags);
	const config = await loadHarnessConfig(configPath);
	const healthItems = await runDoctor(config);
	const summary = summarizeDoctor(healthItems);

	for (const line of summary.lines) {
		console.log(line);
	}

	if (!summary.ok) {
		throw new Error("doctor found one or more blocking issues.");
	}
};

const commitMemoryCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const configPath = getOptionalConfigPath(flags);
	const config = await loadHarnessConfig(configPath);
	if (!config.adapters.memory.enabled) {
		console.log(
			"Memory adapter is disabled. Set adapters.memory.enabled=true to use commit-memory.",
		);
		return;
	}

	const memory = new MemoryService(config);
	const commitMessageFlag = flags.message;
	if (commitMessageFlag === true) {
		throw new Error("--message requires a string value.");
	}

	console.log("Starting project verification...");
	for (const cmd of config.adapters.memory.verifyCommands) {
		console.log(`Running: ${cmd}`);
		const result = await execCommand(cmd, {
			cwd: resolve(config.workspaceRoot),
			timeoutMs: 60000,
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`Verification failed [${cmd}]: ${result.stderr || result.stdout}`,
			);
		}
	}

	console.log("Verification passed. Finding latest successful run...");
	const root = resolve(config.artifactsDir);
	const dirs = await readdir(root, { withFileTypes: true });
	const runDirs = dirs
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort((a, b) => b.localeCompare(a));

	for (const runDir of runDirs) {
		const reportPath = join(root, runDir, "result.json");
		const content = await readFile(reportPath, "utf8").catch(() => null);
		if (!content) {
			continue;
		}

		const parsed = tryParseJson(content);
		let result = null;
		try {
			result = parsed ? parseScenarioResult(parsed) : null;
		} catch {
			continue;
		}
		if (!result) {
			continue;
		}
		if (result.finalDecision === "pass") {
			console.log(`Ingesting verified run: ${runDir}`);
			await memory.ingestVerified(result.scenarioId, result);

			const commitMessage =
				getOptionalStringFlag(flags, "message") ??
				(config.adapters.memory.git.autoCommit
					? `${config.adapters.memory.git.commitMessagePrefix}${result.scenarioId}`
					: undefined);

			if (typeof commitMessage === "string") {
				await memory.gitAddAndCommit(commitMessage);
				if (isTruthyFlag(flags.push) || config.adapters.memory.git.autoPush) {
					await memory.gitPush();
				}
			}

			console.log("Gnosis sync and Git operations completed.");
			return;
		}
	}

	console.log("No successful runs found to ingest.");
};

const main = async (): Promise<void> => {
	const { command, flags } = parseArgv(process.argv.slice(2));

	if (!command || command === "help" || command === "--help") {
		printHelp();
		return;
	}

	if (command === "run") {
		await runCommand(flags);
		return;
	}

	if (command === "eval") {
		await evalCommand(flags);
		return;
	}

	if (command === "report") {
		if (flags.latest) {
			await reportLatest(flags);
			return;
		}
		throw new Error("report currently supports only --latest");
	}

	if (command === "doctor") {
		await doctorCommand(flags);
		return;
	}

	if (command === "commit-memory") {
		await commitMemoryCommand(flags);
		return;
	}

	throw new Error(`Unknown command: ${command}`);
};

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
