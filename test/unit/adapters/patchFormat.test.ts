import { describe, expect, test } from "bun:test";
import { detectPatchFormat } from "../../../src/adapters/patchFormat";

describe("detectPatchFormat", () => {
	test("detects astmend operation JSON", () => {
		const patch = JSON.stringify({
			type: "add_import",
			file: "src/index.ts",
			module: "./x",
			named: [{ name: "X" }],
		});
		expect(detectPatchFormat(patch)).toBe("astmend-json");
	});

	test("detects unified diff", () => {
		const patch = [
			"diff --git a/src/index.ts b/src/index.ts",
			"--- a/src/index.ts",
			"+++ b/src/index.ts",
			"@@ -1,1 +1,2 @@",
			" export const x = 1;",
			"+export const y = 2;",
		].join("\n");
		expect(detectPatchFormat(patch)).toBe("unified-diff");
	});

	test("falls back to file-replace", () => {
		expect(detectPatchFormat("export const x = 1;\n")).toBe("file-replace");
	});
});
