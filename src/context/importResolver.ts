import { dirname, extname, join, normalize, resolve } from "node:path";

const IMPORT_PATTERN =
	/(?:import|export)(?:\s+type)?\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;

const isRelativeImport = (specifier: string): boolean =>
	specifier.startsWith("./") || specifier.startsWith("../");

const resolveExtension = (basePath: string): string => {
	if (extname(basePath)) return basePath;
	return `${basePath}.ts`;
};

export const resolveLocalImports = (
	fileContent: string,
	filePath: string,
	workspaceRoot: string,
): string[] => {
	const fileDir = dirname(resolve(workspaceRoot, filePath));
	const seen = new Set<string>();
	const results: string[] = [];

	IMPORT_PATTERN.lastIndex = 0;
	let match = IMPORT_PATTERN.exec(fileContent);

	while (match !== null) {
		const specifier = match[1];
		if (specifier && isRelativeImport(specifier)) {
			const absolutePath = resolveExtension(join(fileDir, specifier));
			const relativePath = normalize(
				absolutePath.startsWith(workspaceRoot)
					? absolutePath.slice(workspaceRoot.length).replace(/^[/\\]/, "")
					: absolutePath,
			);
			if (!seen.has(relativePath)) {
				seen.add(relativePath);
				results.push(relativePath);
			}
		}
		match = IMPORT_PATTERN.exec(fileContent);
	}

	return results;
};
