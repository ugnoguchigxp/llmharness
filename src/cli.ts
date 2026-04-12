import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type ReviewableFile, reviewCode } from "./adapters/codeReviewer";
import { loadHarnessConfig } from "./config/loadConfig";
import { runDoctor, summarizeDoctor } from "./doctor";
import {
	analyzeDiff,
	type CommitFilterOptions,
	type DiffAnalysis,
	type DiffCategory,
	getCommitHashes,
	shouldIncludeCommit,
} from "./generators/diffAnalyzer";
import { saveGoldenPatch } from "./generators/goldenPatchStore";
import { generateRequirementsFromDiff } from "./generators/requirementsGenerator";
import { generateScenarioFromDiff } from "./generators/scenarioGenerator";
import { loadRequirements } from "./requirements/loadRequirements";
import {
	runAllSuites,
	runSingleScenario,
	runSuite,
	type ScenarioRunResult,
} from "./runner/scenarioRunner";
import { loadScenarioById } from "./scenarios/loadScenario";
import {
	parseScenarioInput,
	parseScenarioResult,
	type ScenarioSuite,
	ScenarioSuiteSchema,
} from "./schemas";
import { MemoryService } from "./services/memoryService";
import {
	clearRunIndex,
	indexRunResult,
	searchRunsInIndex,
} from "./storage/runIndex";
import { parseArgv } from "./utils/argv";
import { runCommand as execCommand } from "./utils/exec";
import { writeJsonFile } from "./utils/fs";
import { tryParseJson } from "./utils/json";

const printHelp = (): void => {
	console.log(
		[
			"llmharness commands:",
			"  run --scenario <id> [--config <path>] [--requirements-path <path>]",
			"  eval --suite <smoke|regression|edge-cases|all> [--config <path>]",
			"  report --latest [--config <path>]",
			"  search-runs --query <text> [--limit <n>] [--config <path>]",
			"  reindex-runs [--config <path>]",
			"  doctor [--config <path>]",
			"  commit-memory [--config <path>] [--message <msg>] [--push]",
			"  generate-scenario --requirements <path> [--id <id>] [--suite <smoke|regression|edge-cases>] [--output <path>]",
			"  generate-from-git (--commit <hash> | --last <n>) --suite <smoke|regression|edge-cases> [--category <bugfix|feature|refactor|test|docs>] [--output <dir>] [--eval] [--config <path>]",
			"  code-review (--files <file1> [file2...] | --git-diff [--staged]) [--save] [--output <path>] [--config <path>]",
		].join("\n"),
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
	const requirementsPath = getOptionalStringFlag(flags, "requirements-path");
	const runDir = await runSingleScenario(
		scenarioId,
		configPath,
		requirementsPath,
	);
	console.log(`run completed: ${runDir}`);
};

const formatRequirementsSummary = (r: ScenarioRunResult): string => {
	const s = r.requirementsSummary;
	if (!s) return "[no requirements]";
	if (s.validationStatus === "not_found") return "[req: not_found]";
	if (s.validationStatus === "invalid") return "[req: invalid]";
	return `[req: valid, criteria=${s.successCriteriaCount}, personas=${s.reviewPersonasCount}]`;
};

const evalCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const suiteArg = assertStringFlag(flags, "suite");
	const configPath = getOptionalConfigPath(flags);
	const results: ScenarioRunResult[] =
		suiteArg === "all"
			? await runAllSuites(configPath)
			: await runSuite(
					ScenarioSuiteSchema.parse(suiteArg) as ScenarioSuite,
					configPath,
				);
	console.log(`eval completed: ${results.length} scenario(s)`);
	for (const r of results) {
		console.log(
			`- ${r.scenarioId} ${formatRequirementsSummary(r)}  ${r.runDir}`,
		);
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

const searchRunsCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const query = assertStringFlag(flags, "query");
	const configPath = getOptionalConfigPath(flags);
	const rawLimit = getOptionalStringFlag(flags, "limit");
	const limit =
		typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : undefined;
	if (
		rawLimit &&
		(typeof limit !== "number" || Number.isNaN(limit) || limit <= 0)
	) {
		throw new Error("--limit must be a positive integer.");
	}

	const config = await loadHarnessConfig(configPath);
	const hits = await searchRunsInIndex({
		config,
		query,
		limit: limit ?? 20,
	});

	if (hits.length === 0) {
		console.log("No indexed runs matched the query.");
		return;
	}

	console.log(`search-runs: ${hits.length} hit(s)`);
	for (const hit of hits) {
		const scoreText =
			typeof hit.finalScore === "number"
				? ` score=${hit.finalScore.toFixed(1)}`
				: "";
		const reqText = hit.requirementsStatus
			? ` req=${hit.requirementsStatus}`
			: "";
		console.log(
			`- ${hit.runId} ${hit.scenarioId} [${hit.suite}] decision=${hit.finalDecision}${scoreText}${reqText}`,
		);
		console.log(`  ${hit.runDir}`);
		if (hit.snippet.trim().length > 0) {
			console.log(`  ${hit.snippet}`);
		}
	}
};

const reindexRunsCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const configPath = getOptionalConfigPath(flags);
	const config = await loadHarnessConfig(configPath);
	const root = resolve(config.artifactsDir);

	await clearRunIndex(config);

	const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
	const runDirs = dirs
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	let indexed = 0;
	let skipped = 0;

	for (const runId of runDirs) {
		const runDir = join(root, runId);
		const reportJsonPath = join(runDir, "result.json");
		const reportMarkdownPath = join(runDir, "result.md");
		const reportSarifPath = join(runDir, "result.sarif.json");
		const content = await readFile(reportJsonPath, "utf8").catch(() => null);
		if (!content) {
			skipped += 1;
			continue;
		}

		const parsed = tryParseJson(content);
		if (!parsed) {
			skipped += 1;
			continue;
		}

		let result: ReturnType<typeof parseScenarioResult>;
		try {
			result = parseScenarioResult(parsed);
		} catch {
			skipped += 1;
			continue;
		}

		let scenarioMeta:
			| {
					suite?: string;
					title?: string;
					instruction?: string;
			  }
			| undefined;
		try {
			const scenario = await loadScenarioById(result.scenarioId);
			scenarioMeta = {
				suite: scenario.suite,
				title: scenario.title,
				instruction: scenario.instruction,
			};
		} catch {
			scenarioMeta = undefined;
		}

		await indexRunResult({
			config,
			result,
			runDir,
			reportJsonPath,
			reportMarkdownPath,
			reportSarifPath,
			scenarioMeta,
		});
		indexed += 1;
	}

	console.log(
		`reindex-runs completed: indexed=${indexed} skipped=${skipped} index=${join(root, "run-index.sqlite")}`,
	);
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

const generateScenarioCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const requirementsPath = assertStringFlag(flags, "requirements");
	const req = await loadRequirements(requirementsPath);

	const suiteArg = getOptionalStringFlag(flags, "suite") ?? "smoke";
	const suite = ScenarioSuiteSchema.parse(suiteArg) as ScenarioSuite;
	const idOverride = getOptionalStringFlag(flags, "id");
	const scenarioId = idOverride ?? req.id.replace(/-req$/, "");

	const scenario = parseScenarioInput({
		id: scenarioId,
		suite,
		title: req.title,
		instruction: req.task,
		targetFiles: ["src/index.ts"],
		expected: { mustPassTests: [], maxRiskErrors: 0, minScore: 80 },
		requirementsPath,
	});

	const defaultOutput = `scenarios/${suite}/${scenarioId}.json`;
	const outputPath = getOptionalStringFlag(flags, "output") ?? defaultOutput;
	const resolved = resolve(outputPath);
	await writeJsonFile(resolved, scenario);
	console.log(`generate-scenario: wrote ${resolved}`);
};

const generateFromGitCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const configPath = getOptionalConfigPath(flags);
	const config = await loadHarnessConfig(configPath);
	const workspaceRoot = resolve(config.workspaceRoot);

	const suiteArg = assertStringFlag(flags, "suite");
	const suite = ScenarioSuiteSchema.parse(suiteArg) as ScenarioSuite;

	const outputDir = resolve(
		getOptionalStringFlag(flags, "output") ?? `scenarios/${suite}`,
	);

	const categoryFilter = getOptionalStringFlag(flags, "category");
	const shouldEval = isTruthyFlag(flags.eval);

	const goldenPatchOutputDir = resolve(
		getOptionalStringFlag(flags, "golden-patch-dir") ??
			`scenarios/${suite}/golden-patches`,
	);

	let commitHashes: string[];

	if (typeof flags.commit === "string" && flags.commit.length > 0) {
		commitHashes = [flags.commit];
	} else if (typeof flags.last === "string" && flags.last.length > 0) {
		const n = Number.parseInt(flags.last, 10);
		if (Number.isNaN(n) || n <= 0) {
			throw new Error("--last must be a positive integer");
		}
		commitHashes = await getCommitHashes(workspaceRoot, n);
	} else {
		throw new Error("generate-from-git requires --commit <hash> or --last <n>");
	}

	console.log(`Analyzing ${commitHashes.length} commit(s)...`);

	const allowedCategories: DiffCategory[] = [
		"bugfix",
		"feature",
		"refactor",
		"test",
		"docs",
		"other",
	];
	const normalizedCategory = categoryFilter
		? allowedCategories.find((c) => c === categoryFilter)
		: undefined;
	if (categoryFilter && !normalizedCategory) {
		throw new Error(
			`Unsupported --category "${categoryFilter}". Allowed: ${allowedCategories.join(", ")}`,
		);
	}

	const generated: string[] = [];
	const skipped: string[] = [];

	for (const hash of commitHashes) {
		let analysis: DiffAnalysis;
		try {
			analysis = await analyzeDiff(hash, workspaceRoot);
		} catch (error) {
			console.warn(
				`  [skip] ${hash.slice(0, 8)}: analysis failed – ${error instanceof Error ? error.message : String(error)}`,
			);
			skipped.push(hash);
			continue;
		}

		const filterOptions: CommitFilterOptions = normalizedCategory
			? { categories: [normalizedCategory] }
			: {};

		if (!shouldIncludeCommit(analysis, filterOptions)) {
			console.log(
				`  [skip] ${hash.slice(0, 8)} "${analysis.commitMessage}" (filtered out)`,
			);
			skipped.push(hash);
			continue;
		}

		if (analysis.files.filter((f) => !f.isDeleted).length === 0) {
			console.log(
				`  [skip] ${hash.slice(0, 8)} "${analysis.commitMessage}" (no non-deleted files)`,
			);
			skipped.push(hash);
			continue;
		}

		const goldenPatchPath = await saveGoldenPatch(
			hash,
			workspaceRoot,
			goldenPatchOutputDir,
		);

		const scenario = generateScenarioFromDiff({
			diff: analysis,
			suite,
			goldenPatchPath,
		});
		const requirements = generateRequirementsFromDiff(analysis);

		const shortHash = hash.slice(0, 8);
		const scenarioPath = join(outputDir, `auto-${shortHash}.json`);
		const requirementsPath = join(outputDir, `auto-${shortHash}-req.json`);

		await writeJsonFile(scenarioPath, scenario);
		await writeJsonFile(requirementsPath, requirements);

		console.log(
			`  [gen]  ${shortHash} "${analysis.commitMessage}" → ${scenarioPath}`,
		);
		generated.push(scenario.id);
	}

	console.log(
		`\ngenerate-from-git: generated ${generated.length}, skipped ${skipped.length}`,
	);

	if (shouldEval && generated.length > 0) {
		console.log(
			`\nRunning eval for ${generated.length} generated scenario(s)...`,
		);
		for (const scenarioId of generated) {
			const runDir = await runSingleScenario(scenarioId, configPath);
			console.log(`  eval: ${scenarioId} → ${runDir}`);
		}
	}
};

const codeReviewCommand = async (
	flags: Record<string, string | boolean>,
): Promise<void> => {
	const configPath = getOptionalConfigPath(flags);
	const config = await loadHarnessConfig(configPath);

	const isGitDiff = isTruthyFlag(flags["git-diff"]);
	const isStaged = isTruthyFlag(flags.staged);
	const shouldSave = isTruthyFlag(flags.save);
	const outputPath = getOptionalStringFlag(flags, "output");

	const hasFiles =
		typeof flags.files === "string" && flags.files.trim().length > 0;

	if (isGitDiff && hasFiles) {
		throw new Error(
			"--files and --git-diff are mutually exclusive. Use one or the other.",
		);
	}

	let filePaths: string[] = [];

	if (isGitDiff) {
		const diffArgs = isStaged
			? "git diff --cached --name-only"
			: "git diff --name-only";
		const result = await execCommand(diffArgs, {
			cwd: resolve(config.workspaceRoot),
			timeoutMs: 10000,
		});
		if (result.exitCode !== 0) {
			throw new Error(`git diff failed: ${result.stderr || result.stdout}`);
		}
		filePaths = result.stdout
			.split("\n")
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		if (filePaths.length === 0) {
			console.log("No changed files found.");
			return;
		}
	} else {
		if (!hasFiles) {
			throw new Error(
				"code-review requires --files <file1> [file2...] or --git-diff",
			);
		}
		const rawFiles = flags.files as string;
		filePaths = rawFiles
			.split(/[\s,]+/)
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
	}

	const workspaceRoot = resolve(config.workspaceRoot);
	const reviewableFiles: ReviewableFile[] = [];
	for (const filePath of filePaths) {
		const absPath = resolve(workspaceRoot, filePath);
		const content = await readFile(absPath, "utf8").catch(() => null);
		if (content === null) {
			console.warn(`  [skip] ${filePath}: file not found`);
			continue;
		}
		reviewableFiles.push({ path: filePath, content });
	}

	if (reviewableFiles.length === 0) {
		console.log("No readable files to review.");
		return;
	}

	console.log(
		`Running code review on ${reviewableFiles.length} file(s):\n${reviewableFiles.map((f) => `  - ${f.path}`).join("\n")}`,
	);

	const reviewResult = await reviewCode({ files: reviewableFiles, config });

	console.log(`\nOverall: ${reviewResult.overallAssessment}`);
	console.log(`Summary: ${reviewResult.summary}`);
	if (reviewResult.findings.length > 0) {
		console.log(`\nFindings (${reviewResult.findings.length}):`);
		for (const finding of reviewResult.findings) {
			const loc = finding.file
				? finding.line
					? ` ${finding.file}:${finding.line}`
					: ` ${finding.file}`
				: "";
			console.log(`  [${finding.severity}]${loc}: ${finding.message}`);
			if (finding.suggestion) {
				console.log(`    → ${finding.suggestion}`);
			}
		}
	} else {
		console.log("\nNo findings.");
	}

	if (outputPath) {
		const resolved = resolve(outputPath);
		await writeJsonFile(resolved, reviewResult);
		console.log(`\nReview saved to: ${resolved}`);
	}

	if (shouldSave) {
		if (!config.adapters.memory.enabled) {
			console.warn(
				"Memory adapter is disabled. Set adapters.memory.enabled=true to save to Gnosis.",
			);
		} else {
			const memory = new MemoryService(config);
			await memory.ingestReview(reviewResult);
			console.log("Review ingested into Gnosis.");
		}
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

			// Trigger KnowFlow task to expand knowledge around this verified solution
			let topic = result.scenarioId;
			try {
				const scenario = await loadScenarioById(result.scenarioId);
				topic = scenario.title || result.scenarioId;
			} catch (_) {
				console.warn(
					`Failed to load scenario ${result.scenarioId} for task meta, using ID as topic.`,
				);
			}

			console.log(`Enqueuing KnowFlow task for topic: ${topic}`);
			await memory.enqueueKnowFlowTask(topic, { mode: "expand" });

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

	if (command === "search-runs") {
		await searchRunsCommand(flags);
		return;
	}

	if (command === "reindex-runs") {
		await reindexRunsCommand(flags);
		return;
	}

	if (command === "commit-memory") {
		await commitMemoryCommand(flags);
		return;
	}

	if (command === "generate-scenario") {
		await generateScenarioCommand(flags);
		return;
	}

	if (command === "generate-from-git") {
		await generateFromGitCommand(flags);
		return;
	}

	if (command === "code-review") {
		await codeReviewCommand(flags);
		return;
	}

	throw new Error(`Unknown command: ${command}`);
};

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
