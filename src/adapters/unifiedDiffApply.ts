import { resolve } from "node:path";
import type { ApplyResult } from "../schemas";
import { parseApplyResult } from "../schemas";
import { runCommand } from "../utils/exec";
import type { AstmendApplyInput } from "./astmend";

const normalizeDiffPath = (value: string): string | undefined => {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed === "/dev/null") {
		return undefined;
	}
	const pathPart = trimmed.split("\t")[0]?.trim();
	if (!pathPart || pathPart.length === 0) {
		return undefined;
	}
	return pathPart.replace(/^"(.+)"$/, "$1").replace(/^[ab]\//, "");
};

const normalizeComparablePath = (value: string): string =>
	value.replace(/\\/g, "/").replace(/^\.\//, "");

const parsePatchedFilesFromDiff = (patch: string): string[] => {
	const files: string[] = [];
	for (const line of patch.split("\n")) {
		if (line.startsWith("+++ ") || line.startsWith("--- ")) {
			const maybePath = normalizeDiffPath(line.slice(4));
			if (maybePath && !files.includes(maybePath)) {
				files.push(maybePath);
			}
		}
	}
	return files;
};

const extractHunkSummary = (patch: string): string | undefined => {
	const matches = patch.match(
		/@@[\s\S]*?(?=\n@@|\n(?:diff --git |--- |\+\+\+ )|$)/g,
	);
	if (!matches || matches.length === 0) {
		return undefined;
	}
	const normalized = matches
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	if (normalized.length === 0) {
		return undefined;
	}
	const MAX_HUNKS = 5;
	const trimmed = normalized.slice(0, MAX_HUNKS);
	const suffix =
		normalized.length > MAX_HUNKS
			? `\n... (${normalized.length - MAX_HUNKS} more hunks omitted)`
			: "";
	return `${trimmed.join("\n---\n")}${suffix}`;
};

const isWorkspaceSafe = (
	workspaceRoot: string,
	relativePath: string,
): boolean => {
	const absolute = resolve(workspaceRoot, relativePath);
	return absolute.startsWith(`${workspaceRoot}/`) || absolute === workspaceRoot;
};

const buildRejectResult = (
	targetFiles: string[],
	impactedFiles: string[],
	reason: string,
	diagnostics: string[],
	hunk?: string,
): ApplyResult =>
	parseApplyResult({
		success: false,
		patchedFiles: [],
		rejects: (impactedFiles.length > 0 ? impactedFiles : targetFiles).map(
			(path) => ({
				path,
				reason,
				hunk,
			}),
		),
		diagnostics,
	});

export const applyUnifiedDiff = async (
	input: AstmendApplyInput,
): Promise<ApplyResult> => {
	const { patch, targetFiles, config } = input;
	const workspaceRoot = resolve(config.workspaceRoot);
	const hunkSummary = extractHunkSummary(patch);
	const targetPathLookup = new Map(
		targetFiles.map((path) => [normalizeComparablePath(path), path]),
	);
	const impactedFiles = parsePatchedFilesFromDiff(patch).map((path) =>
		normalizeComparablePath(path),
	);

	if (impactedFiles.length === 0) {
		return buildRejectResult(
			targetFiles,
			[],
			"Unified diff does not include file headers.",
			["Unified diff parse failed: no +++ or diff --git file headers."],
			hunkSummary,
		);
	}

	const outsideTarget = impactedFiles.find(
		(file) => !targetPathLookup.has(file),
	);
	if (outsideTarget) {
		return buildRejectResult(
			targetFiles,
			[outsideTarget],
			"Patch touches file outside scenario targetFiles.",
			[`Rejected unified diff for ${outsideTarget}; outside targetFiles.`],
			hunkSummary,
		);
	}

	const unsafeFile = impactedFiles.find(
		(file) => !isWorkspaceSafe(workspaceRoot, file),
	);
	if (unsafeFile) {
		return buildRejectResult(
			targetFiles,
			[unsafeFile],
			"Patch path resolves outside workspaceRoot.",
			["Rejected unified diff with unsafe path."],
			hunkSummary,
		);
	}

	const stripLevels = [1, 0];
	let lastDryRunError = "Failed to apply unified diff.";

	for (const stripLevel of stripLevels) {
		const dryRun = await runCommand(
			`patch -p${stripLevel} --forward --reject-file=- --dry-run`,
			{
				cwd: workspaceRoot,
				stdin: patch,
				timeoutMs: config.adapters.astmend.timeoutMs,
			},
		);

		if (dryRun.exitCode !== 0) {
			lastDryRunError =
				dryRun.stderr.trim() || dryRun.stdout.trim() || lastDryRunError;
			continue;
		}

		const apply = await runCommand(
			`patch -p${stripLevel} --forward --reject-file=-`,
			{
				cwd: workspaceRoot,
				stdin: patch,
				timeoutMs: config.adapters.astmend.timeoutMs,
			},
		);
		if (apply.exitCode !== 0) {
			const reason =
				apply.stderr.trim() ||
				apply.stdout.trim() ||
				`patch command failed with exit code ${apply.exitCode}`;
			return buildRejectResult(
				targetFiles,
				impactedFiles,
				"Unified diff apply command failed.",
				[`patch -p${stripLevel} failed: ${reason}`],
				hunkSummary,
			);
		}

		return parseApplyResult({
			success: true,
			patchedFiles: impactedFiles.map(
				(path) => targetPathLookup.get(path) ?? path,
			),
			rejects: [],
			diagnostics: [`Unified diff applied with patch -p${stripLevel}.`],
			diff: patch,
		});
	}

	return buildRejectResult(
		targetFiles,
		impactedFiles,
		"Unified diff dry-run failed.",
		[lastDryRunError],
		hunkSummary,
	);
};
