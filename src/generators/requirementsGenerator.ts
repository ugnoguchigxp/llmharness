import type { Requirements } from "../schemas";
import { parseRequirements } from "../schemas";
import type { DiffAnalysis } from "./diffAnalyzer";

const buildSuccessCriteria = (diff: DiffAnalysis): string[] => {
	const criteria: string[] = [
		`The change described in "${diff.commitMessage}" is correctly applied`,
		`Only the specified files are modified: ${diff.files.map((f) => f.path).join(", ")}`,
	];

	if (diff.category === "bugfix") {
		criteria.push("The bug described in the commit message is fixed");
	}

	if (diff.category === "feature") {
		criteria.push("The new feature is implemented as described in the commit message");
	}

	if (diff.category === "refactor") {
		criteria.push("Existing behavior is preserved after the refactor");
	}

	if (diff.category === "test") {
		criteria.push("New tests are added and pass successfully");
	}

	return criteria;
};

export const generateRequirementsFromDiff = (diff: DiffAnalysis): Requirements => {
	const shortHash = diff.commitHash.slice(0, 8);
	const fileList = diff.files.map((f) => f.path).join(", ");

	return parseRequirements({
		id: `auto-${shortHash}-req`,
		title: diff.commitMessage || `Auto-generated from ${shortHash}`,
		task: `Reproduce the change: ${diff.commitMessage}`,
		constraints: [
			`Modify only: ${fileList}`,
			`Changes should be ${diff.complexity} in complexity`,
		],
		successCriteria: buildSuccessCriteria(diff),
		reviewPersonas: [],
	});
};
