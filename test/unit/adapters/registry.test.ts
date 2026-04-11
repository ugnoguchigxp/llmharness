import { describe, expect, test } from "bun:test";
import { ensureBuiltinAdaptersRegistered } from "../../../src/adapters/registerBuiltins";
import {
	listRegisteredAdapterNames,
	registerPatchApplier,
	resolvePatchApplier,
} from "../../../src/adapters/registry";
import { parseApplyResult, parseHarnessConfig } from "../../../src/schemas";

describe("adapter registry", () => {
	test("built-in adapters are registered", () => {
		ensureBuiltinAdaptersRegistered();
		const names = listRegisteredAdapterNames();

		expect(names.generators).toContain("localLlm");
		expect(names.riskReviewers).toContain("diffGuard");
		expect(names.patchAppliers).toContain("astmend-json");
		expect(names.patchAppliers).toContain("unified-diff");
		expect(names.patchAppliers).toContain("file-replace");
	});

	test("custom patch applier can be registered and resolved", async () => {
		const adapterName = "unit-test-custom-applier";
		const customApplier = async () =>
			parseApplyResult({
				success: true,
				patchedFiles: ["src/index.ts"],
				rejects: [],
				diagnostics: ["custom adapter executed"],
			});

		registerPatchApplier(adapterName, customApplier);
		const resolved = resolvePatchApplier(adapterName);
		const config = parseHarnessConfig({
			runtime: "bun",
			workspaceRoot: ".",
			artifactsDir: "artifacts/runs",
			adapters: {
				localLlm: {
					mode: "cli",
					command: "localLlm --json",
					model: "test",
				},
				astmend: {
					mode: "lib",
					libEntrypoint: "../Astmend/dist/index.js",
				},
				diffGuard: {
					mode: "cli",
					command: "diffguard --format json",
				},
			},
		});

		expect(resolved).toBe(customApplier);
		const result = await resolved?.({
			patch: "dummy",
			targetFiles: ["src/index.ts"],
			config,
		});
		expect(result?.success).toBe(true);
	});
});
