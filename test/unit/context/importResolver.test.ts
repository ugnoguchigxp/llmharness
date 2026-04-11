import { describe, expect, test } from "bun:test";
import { resolveLocalImports } from "../../../src/context/importResolver";

const WS = "/workspace";

describe("resolveLocalImports", () => {
	test("resolves named import from relative path", () => {
		const content = `import { foo } from "./utils";`;
		const result = resolveLocalImports(content, "src/index.ts", WS);
		expect(result).toContain("src/utils.ts");
	});

	test("resolves type import", () => {
		const content = `import type { Foo } from "../schemas";`;
		const result = resolveLocalImports(content, "src/adapters/localllm.ts", WS);
		expect(result).toContain("src/schemas.ts");
	});

	test("resolves re-export", () => {
		const content = `export { bar } from "./bar";`;
		const result = resolveLocalImports(content, "src/index.ts", WS);
		expect(result).toContain("src/bar.ts");
	});

	test("ignores non-relative imports (node_modules)", () => {
		const content = `import { z } from "zod";`;
		const result = resolveLocalImports(content, "src/index.ts", WS);
		expect(result).toHaveLength(0);
	});

	test("ignores node: builtins", () => {
		const content = `import { resolve } from "node:path";`;
		const result = resolveLocalImports(content, "src/index.ts", WS);
		expect(result).toHaveLength(0);
	});

	test("handles multiple imports", () => {
		const content = [
			`import { a } from "./a";`,
			`import { b } from "./b";`,
			`import { c } from "zod";`,
		].join("\n");
		const result = resolveLocalImports(content, "src/index.ts", WS);
		expect(result).toContain("src/a.ts");
		expect(result).toContain("src/b.ts");
		expect(result).not.toContain("zod");
		expect(result).toHaveLength(2);
	});

	test("deduplicates same import", () => {
		const content = [
			`import { a } from "./utils";`,
			`import type { b } from "./utils";`,
		].join("\n");
		const result = resolveLocalImports(content, "src/index.ts", WS);
		expect(result).toHaveLength(1);
	});

	test("resolves parent directory import", () => {
		const content = `import { x } from "../schemas/domain";`;
		const result = resolveLocalImports(content, "src/adapters/localllm.ts", WS);
		expect(result).toContain("src/schemas/domain.ts");
	});

	test("returns empty array for empty content", () => {
		const result = resolveLocalImports("", "src/index.ts", WS);
		expect(result).toHaveLength(0);
	});
});
