import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { HarnessConfig, ScenarioInput, ScenarioResult } from "../schemas";

const RUN_INDEX_FILENAME = "run-index.sqlite";
const UNKNOWN_SUITE = "unknown";

type RunScenarioMeta = {
	id: string;
	suite: string;
	title: string;
	instruction: string;
};

const ensureSchema = (db: Database): void => {
	db.run(`
		CREATE TABLE IF NOT EXISTS runs (
			run_id TEXT PRIMARY KEY,
			run_dir TEXT NOT NULL,
			scenario_id TEXT NOT NULL,
			suite TEXT NOT NULL,
			final_decision TEXT NOT NULL,
			final_score REAL,
			duration_ms INTEGER NOT NULL,
			requirements_status TEXT,
			requirements_title TEXT,
			report_json_path TEXT,
			report_markdown_path TEXT,
			report_sarif_path TEXT,
			search_text TEXT NOT NULL,
			indexed_at TEXT NOT NULL
		);
	`);
	db.run(`
		CREATE INDEX IF NOT EXISTS idx_runs_scenario_id
			ON runs (scenario_id);
	`);
	db.run(`
		CREATE INDEX IF NOT EXISTS idx_runs_suite
			ON runs (suite);
	`);
	db.run(`
		CREATE INDEX IF NOT EXISTS idx_runs_final_decision
			ON runs (final_decision);
	`);
	db.run(`
		CREATE INDEX IF NOT EXISTS idx_runs_indexed_at
			ON runs (indexed_at DESC);
	`);
	db.run(`
		CREATE VIRTUAL TABLE IF NOT EXISTS runs_fts USING fts5(
			run_id UNINDEXED,
			scenario_id,
			suite,
			final_decision,
			requirements_title,
			search_text
		);
	`);
};

const withRunIndexDb = async <T>(
	config: HarnessConfig,
	handler: (db: Database) => T | Promise<T>,
): Promise<T> => {
	const dbPath = resolveRunIndexPath(config);
	await mkdir(resolve(config.artifactsDir), { recursive: true });
	const db = new Database(dbPath, { create: true });
	try {
		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA busy_timeout = 3000");
		ensureSchema(db);
		return await handler(db);
	} finally {
		db.close();
	}
};

const buildSearchText = (
	scenario: RunScenarioMeta,
	result: ScenarioResult,
): string => {
	const finalJudgeReasons = result.judges
		.filter((judge) => judge.phase === "final")
		.flatMap((judge) => judge.reasons);
	const allJudgeReasons = result.judges.flatMap((judge) => judge.reasons);
	const riskMessages =
		result.risk?.findings.map((finding) => finding.message) ?? [];
	const applyRejects =
		result.apply?.rejects.map((reject) => `${reject.path}: ${reject.reason}`) ??
		[];
	const personaFeedback = result.personaReviews.map(
		(review) => review.feedback,
	);
	return [
		scenario.title,
		scenario.instruction,
		result.generate?.summary ?? "",
		result.requirementsSummary?.title ?? "",
		finalJudgeReasons.join("\n"),
		allJudgeReasons.join("\n"),
		riskMessages.join("\n"),
		applyRejects.join("\n"),
		result.revisionSuggestions.join("\n"),
		personaFeedback.join("\n"),
	]
		.filter((value) => value.trim().length > 0)
		.join("\n\n");
};

const quoteForFts = (token: string): string => token.replace(/"/g, '""');

const toFtsQuery = (query: string): string => {
	const tokens = query
		.trim()
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	return tokens.map((token) => `"${quoteForFts(token)}"*`).join(" AND ");
};

const toNumber = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "bigint") {
		return Number(value);
	}
	return undefined;
};

const toStringValue = (value: unknown): string => {
	if (typeof value === "string") return value;
	return "";
};

export type RunSearchHit = {
	runId: string;
	runDir: string;
	scenarioId: string;
	suite: string;
	finalDecision: "pass" | "fail" | "error";
	finalScore?: number;
	durationMs: number;
	requirementsStatus?: "valid" | "invalid" | "not_found";
	requirementsTitle?: string;
	indexedAt: string;
	snippet: string;
};

type RunSearchRow = {
	run_id: unknown;
	run_dir: unknown;
	scenario_id: unknown;
	suite: unknown;
	final_decision: unknown;
	final_score: unknown;
	duration_ms: unknown;
	requirements_status: unknown;
	requirements_title: unknown;
	indexed_at: unknown;
	snippet: unknown;
};

export const resolveRunIndexPath = (config: HarnessConfig): string => {
	return resolve(config.artifactsDir, RUN_INDEX_FILENAME);
};

export const clearRunIndex = async (config: HarnessConfig): Promise<void> => {
	await withRunIndexDb(config, (db) => {
		const tx = db.transaction(() => {
			db.run("DELETE FROM runs");
			db.run("DELETE FROM runs_fts");
		});
		tx();
	});
};

type IndexRunInput = {
	config: HarnessConfig;
	scenario: RunScenarioMeta;
	result: ScenarioResult;
	runDir: string;
	reportJsonPath: string;
	reportMarkdownPath: string;
	reportSarifPath: string;
};

const indexRun = async (input: IndexRunInput): Promise<void> => {
	const {
		config,
		scenario,
		result,
		runDir,
		reportJsonPath,
		reportMarkdownPath,
		reportSarifPath,
	} = input;

	const runId = basename(runDir);
	const indexedAt = new Date().toISOString();
	const finalScore = result.judges.find(
		(judge) => judge.phase === "final",
	)?.score;
	const searchText = buildSearchText(scenario, result);
	const requirementsStatus = result.requirementsSummary?.validationStatus;
	const requirementsTitle = result.requirementsSummary?.title;

	await withRunIndexDb(config, (db) => {
		const upsertRun = db.query(`
			INSERT INTO runs (
				run_id,
				run_dir,
				scenario_id,
				suite,
				final_decision,
				final_score,
				duration_ms,
				requirements_status,
				requirements_title,
				report_json_path,
				report_markdown_path,
				report_sarif_path,
				search_text,
				indexed_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(run_id) DO UPDATE SET
				run_dir = excluded.run_dir,
				scenario_id = excluded.scenario_id,
				suite = excluded.suite,
				final_decision = excluded.final_decision,
				final_score = excluded.final_score,
				duration_ms = excluded.duration_ms,
				requirements_status = excluded.requirements_status,
				requirements_title = excluded.requirements_title,
				report_json_path = excluded.report_json_path,
				report_markdown_path = excluded.report_markdown_path,
				report_sarif_path = excluded.report_sarif_path,
				search_text = excluded.search_text,
				indexed_at = excluded.indexed_at;
		`);
		const deleteFts = db.query(`DELETE FROM runs_fts WHERE run_id = ?`);
		const insertFts = db.query(`
			INSERT INTO runs_fts (
				run_id,
				scenario_id,
				suite,
				final_decision,
				requirements_title,
				search_text
			)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		const transaction = db.transaction(() => {
			upsertRun.run(
				runId,
				runDir,
				scenario.id,
				scenario.suite,
				result.finalDecision,
				finalScore ?? null,
				result.durationMs,
				requirementsStatus ?? null,
				requirementsTitle ?? null,
				reportJsonPath,
				reportMarkdownPath,
				reportSarifPath,
				searchText,
				indexedAt,
			);
			deleteFts.run(runId);
			insertFts.run(
				runId,
				scenario.id,
				scenario.suite,
				result.finalDecision,
				requirementsTitle ?? "",
				searchText,
			);
		});
		transaction();
	});
};

export const indexScenarioRun = async (input: {
	config: HarnessConfig;
	scenario: ScenarioInput;
	result: ScenarioResult;
	runDir: string;
	reportJsonPath: string;
	reportMarkdownPath: string;
	reportSarifPath: string;
}): Promise<void> => {
	const scenarioMeta: RunScenarioMeta = {
		id: input.scenario.id,
		suite: input.scenario.suite,
		title: input.scenario.title,
		instruction: input.scenario.instruction,
	};
	await indexRun({
		...input,
		scenario: scenarioMeta,
	});
};

export const indexRunResult = async (input: {
	config: HarnessConfig;
	result: ScenarioResult;
	runDir: string;
	reportJsonPath: string;
	reportMarkdownPath: string;
	reportSarifPath: string;
	scenarioMeta?: {
		suite?: string;
		title?: string;
		instruction?: string;
	};
}): Promise<void> => {
	const scenarioMeta: RunScenarioMeta = {
		id: input.result.scenarioId,
		suite: input.scenarioMeta?.suite ?? UNKNOWN_SUITE,
		title: input.scenarioMeta?.title ?? "",
		instruction: input.scenarioMeta?.instruction ?? "",
	};
	await indexRun({
		config: input.config,
		scenario: scenarioMeta,
		result: input.result,
		runDir: input.runDir,
		reportJsonPath: input.reportJsonPath,
		reportMarkdownPath: input.reportMarkdownPath,
		reportSarifPath: input.reportSarifPath,
	});
};

export const searchRunsInIndex = async (input: {
	config: HarnessConfig;
	query: string;
	limit?: number;
}): Promise<RunSearchHit[]> => {
	const { config, query, limit = 20 } = input;
	const ftsQuery = toFtsQuery(query);
	if (ftsQuery.length === 0) {
		return [];
	}

	return withRunIndexDb(config, (db) => {
		const search = db.query(`
			SELECT
				r.run_id,
				r.run_dir,
				r.scenario_id,
				r.suite,
				r.final_decision,
				r.final_score,
				r.duration_ms,
				r.requirements_status,
				r.requirements_title,
				r.indexed_at,
				snippet(runs_fts, 5, '[', ']', ' ... ', 24) AS snippet
			FROM runs_fts
			INNER JOIN runs r ON r.run_id = runs_fts.run_id
			WHERE runs_fts MATCH ?
			ORDER BY bm25(runs_fts), r.indexed_at DESC
			LIMIT ?
		`);

		const rows = search.all(
			ftsQuery,
			Math.max(1, Math.trunc(limit)),
		) as RunSearchRow[];
		return rows.flatMap((row) => {
			const decision = toStringValue(row.final_decision);
			if (decision !== "pass" && decision !== "fail" && decision !== "error") {
				return [];
			}
			const durationMs = toNumber(row.duration_ms);
			if (durationMs === undefined) {
				return [];
			}

			const requirementsStatus = toStringValue(row.requirements_status);
			const normalizedRequirementsStatus =
				requirementsStatus === "valid" ||
				requirementsStatus === "invalid" ||
				requirementsStatus === "not_found"
					? requirementsStatus
					: undefined;

			const requirementsTitle = toStringValue(row.requirements_title);
			const snippet = toStringValue(row.snippet);

			return [
				{
					runId: toStringValue(row.run_id),
					runDir: toStringValue(row.run_dir),
					scenarioId: toStringValue(row.scenario_id),
					suite: toStringValue(row.suite),
					finalDecision: decision,
					finalScore: toNumber(row.final_score),
					durationMs,
					requirementsStatus: normalizedRequirementsStatus,
					requirementsTitle:
						requirementsTitle.length > 0 ? requirementsTitle : undefined,
					indexedAt: toStringValue(row.indexed_at),
					snippet,
				} satisfies RunSearchHit,
			];
		});
	});
};
