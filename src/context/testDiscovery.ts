import { existsSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";

const stripExtension = (filename: string): string =>
	filename.replace(/\.(ts|tsx|js|jsx)$/, "");

const candidates = (filePath: string): string[] => {
	const dir = dirname(filePath);
	const base = stripExtension(basename(filePath));

	// Remove leading "src/" segment to build test paths
	const withoutSrc = filePath.replace(/^src[/\\]/, "");
	const testBase = stripExtension(withoutSrc);

	return [
		// Convention: test/unit/<same-relative-path>.test.ts
		normalize(join("test", "unit", `${testBase}.test.ts`)),
		// Convention: test/<same-relative-path>.test.ts
		normalize(join("test", `${testBase}.test.ts`)),
		// Convention: test/contract/<dir-relative>/<base>.contract.test.ts
		normalize(
			join(
				"test",
				"contract",
				dir.replace(/^src[/\\]?/, ""),
				`${base}.contract.test.ts`,
			),
		),
		// Same directory alongside source
		normalize(join(dir, `${base}.test.ts`)),
	];
};

export const discoverTestFiles = (
	filePath: string,
	workspaceRoot: string,
): string[] => {
	const found: string[] = [];
	for (const candidate of candidates(filePath)) {
		const absolute = join(workspaceRoot, candidate);
		if (existsSync(absolute)) {
			found.push(candidate);
		}
	}
	return found;
};
