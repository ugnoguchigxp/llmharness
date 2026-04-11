import { runCommand } from "../utils/exec";

export type DiffComplexity = "trivial" | "simple" | "moderate" | "complex";
export type DiffCategory =
	| "bugfix"
	| "feature"
	| "refactor"
	| "test"
	| "docs"
	| "other";

export type DiffFile = {
	path: string;
	additions: number;
	deletions: number;
	isNew: boolean;
	isDeleted: boolean;
	isRenamed: boolean;
};

export type DiffAnalysis = {
	commitHash: string;
	commitMessage: string;
	author: string;
	date: string;
	files: DiffFile[];
	totalAdditions: number;
	totalDeletions: number;
	complexity: DiffComplexity;
	category: DiffCategory;
	isMergeCommit: boolean;
};

const CATEGORY_PREFIXES: Array<[string, DiffCategory]> = [
	["fix:", "bugfix"],
	["bug:", "bugfix"],
	["feat:", "feature"],
	["feature:", "feature"],
	["refactor:", "refactor"],
	["test:", "test"],
	["tests:", "test"],
	["docs:", "docs"],
	["doc:", "docs"],
];

export const inferCategory = (
	commitMessage: string,
	files: DiffFile[],
): DiffCategory => {
	const lower = commitMessage.toLowerCase().trim();
	for (const [prefix, category] of CATEGORY_PREFIXES) {
		if (lower.startsWith(prefix)) {
			return category;
		}
	}

	const hasTestFiles = files.some(
		(f) =>
			f.path.includes(".test.") ||
			f.path.includes(".spec.") ||
			f.path.includes("/test/") ||
			f.path.includes("/tests/"),
	);
	if (hasTestFiles) return "test";

	const hasDocFiles =
		files.length > 0 &&
		files.every((f) => f.path.endsWith(".md") || f.path.endsWith(".txt"));
	if (hasDocFiles) return "docs";

	return "other";
};

export const inferComplexity = (
	fileCount: number,
	totalChangedLines: number,
): DiffComplexity => {
	if (fileCount <= 1 && totalChangedLines <= 5) return "trivial";
	if (fileCount <= 2 && totalChangedLines <= 30) return "simple";
	if (fileCount <= 5 && totalChangedLines <= 100) return "moderate";
	return "complex";
};

export const parseNumStatLine = (line: string): DiffFile | null => {
	const parts = line.split("\t");
	if (parts.length < 3) return null;
	const [addStr, delStr, pathPart] = parts;
	if (!addStr || !delStr || !pathPart) return null;

	const additions = addStr === "-" ? 0 : Number.parseInt(addStr, 10);
	const deletions = delStr === "-" ? 0 : Number.parseInt(delStr, 10);
	if (Number.isNaN(additions) || Number.isNaN(deletions)) return null;

	const isRenamed = pathPart.includes(" => ");
	const path = isRenamed
		? (pathPart.match(/^(.+?) => (.+?)$/)?.at(2) ?? pathPart).trim()
		: pathPart.trim();

	return {
		path,
		additions,
		deletions,
		isNew: additions > 0 && deletions === 0,
		isDeleted: deletions > 0 && additions === 0,
		isRenamed,
	};
};

export type RawDiffOutput = {
	logOutput: string;
	numstatOutput: string;
};

export const parseDiffAnalysisFromRawOutput = (
	commitHash: string,
	raw: RawDiffOutput,
): DiffAnalysis => {
	const logLines = raw.logOutput.trim().split("\n");
	const hash = logLines[0]?.trim() ?? commitHash;
	const parents = logLines[1]?.trim() ?? "";
	const commitMessage = logLines[2]?.trim() ?? "";
	const author = logLines[3]?.trim() ?? "";
	const date = logLines[4]?.trim() ?? "";

	const isMergeCommit = parents.includes(" ");

	const files: DiffFile[] = raw.numstatOutput
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map(parseNumStatLine)
		.filter((f): f is DiffFile => f !== null);

	const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
	const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
	const complexity = inferComplexity(
		files.length,
		totalAdditions + totalDeletions,
	);
	const category = inferCategory(commitMessage, files);

	return {
		commitHash: hash,
		commitMessage,
		author,
		date,
		files,
		totalAdditions,
		totalDeletions,
		complexity,
		category,
		isMergeCommit,
	};
};

export const analyzeDiff = async (
	commitHash: string,
	workspaceRoot: string,
): Promise<DiffAnalysis> => {
	const logResult = await runCommand(
		`git show --no-patch --format="%H%n%P%n%s%n%an%n%ci" ${commitHash}`,
		{ cwd: workspaceRoot, timeoutMs: 10000 },
	);

	if (logResult.exitCode !== 0) {
		throw new Error(
			`git show failed for ${commitHash}: ${logResult.stderr || logResult.stdout}`,
		);
	}

	const numstatResult = await runCommand(
		`git diff --numstat ${commitHash}^..${commitHash}`,
		{ cwd: workspaceRoot, timeoutMs: 10000 },
	);

	if (numstatResult.exitCode !== 0) {
		throw new Error(
			`git diff --numstat failed for ${commitHash}: ${numstatResult.stderr || numstatResult.stdout}`,
		);
	}

	return parseDiffAnalysisFromRawOutput(commitHash, {
		logOutput: logResult.stdout,
		numstatOutput: numstatResult.stdout,
	});
};

export type CommitFilterOptions = {
	maxChangedLines?: number;
	categories?: DiffCategory[];
};

export const shouldIncludeCommit = (
	analysis: DiffAnalysis,
	options: CommitFilterOptions = {},
): boolean => {
	if (analysis.isMergeCommit) return false;

	const { files, totalAdditions, totalDeletions } = analysis;

	const allDocOrConfig = files.every(
		(f) =>
			f.path.endsWith(".md") ||
			f.path.endsWith(".txt") ||
			f.path.endsWith(".json") ||
			f.path.endsWith(".yaml") ||
			f.path.endsWith(".yml") ||
			f.path.endsWith(".toml"),
	);
	if (allDocOrConfig) return false;

	const maxLines = options.maxChangedLines ?? 200;
	if (totalAdditions + totalDeletions > maxLines) return false;

	if (options.categories && options.categories.length > 0) {
		if (!options.categories.includes(analysis.category)) return false;
	}

	return true;
};

export const getCommitHashes = async (
	workspaceRoot: string,
	count: number,
): Promise<string[]> => {
	const result = await runCommand(`git log --format="%H" -${count}`, {
		cwd: workspaceRoot,
		timeoutMs: 10000,
	});

	if (result.exitCode !== 0) {
		throw new Error(`git log failed: ${result.stderr || result.stdout}`);
	}

	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
};
