import { describe, expect, test } from "bun:test";
import { applyWithAstmend } from "../../../src/adapters/astmend";
import { reviewWithDiffGuard } from "../../../src/adapters/diffguard";
import { generateWithLocalLlm } from "../../../src/adapters/localllm";
import { parseHarnessConfig, parseScenarioInput } from "../../../src/schemas";

const scenario = parseScenarioInput({
	id: "contract-api-001",
	suite: "smoke",
	title: "api contract",
	instruction: "Return operation.",
	targetFiles: ["src/index.ts"],
	expected: {
		mustPassTests: [],
		maxRiskErrors: 0,
		minScore: 80,
	},
});

describe("adapter API contract", () => {
	test("localLlm accepts OpenAI-compatible content array", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: async (request) => {
				expect(request.method).toBe("POST");
				const payload = (await request.json()) as Record<string, unknown>;
				expect(typeof payload.model).toBe("string");
				return Response.json({
					choices: [
						{
							message: {
								content: [
									{
										text: '{"type":"add_import","module":"./api","named":[{"name":"ApiSymbol"}]}',
									},
								],
							},
						},
					],
					usage: {
						prompt_tokens: 12,
						completion_tokens: 9,
						total_tokens: 21,
					},
				});
			},
		});

		try {
			const baseUrl = `http://127.0.0.1:${server.port}`;
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: ".",
				adapters: {
					localLlm: {
						mode: "api",
						apiBaseUrl: baseUrl,
						apiPath: "/v1/chat/completions",
						model: "test-model",
						timeoutMs: 5000,
						temperature: 0,
					},
					astmend: {
						mode: "lib",
						libEntrypoint: "../Astmend/dist/index.js",
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});

			const result = await generateWithLocalLlm({ scenario, config });
			const patch = JSON.parse(result.patch) as Record<string, unknown>;
			expect(patch.type).toBe("add_import");
			expect(patch.file).toBe("src/index.ts");
			expect(result.tokenUsage?.totalTokens).toBe(21);
		} finally {
			await server.stop(true);
		}
	});

	test("astmend normalizes API response shape", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: async () => {
				return Response.json({
					success: true,
					diagnostics: ["applied"],
					diff: "Index: src/index.ts\\n+import { ApiSymbol } from './api';\\n",
				});
			},
		});

		try {
			const baseUrl = `http://127.0.0.1:${server.port}`;
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: ".",
				adapters: {
					localLlm: {
						mode: "cli",
						command: "echo '{}'",
						model: "test-model",
					},
					astmend: {
						mode: "api",
						endpoint: baseUrl,
						apiPath: "/apply",
						timeoutMs: 5000,
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});

			const result = await applyWithAstmend({
				patch: JSON.stringify({ type: "add_import", file: "src/index.ts" }),
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			expect(result.patchedFiles).toEqual(["src/index.ts"]);
			expect(result.diff?.includes("Index: src/index.ts")).toBe(true);
		} finally {
			await server.stop(true);
		}
	});

	test("diffGuard accepts API array payload", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: async () => {
				return Response.json([
					{
						id: "DG900",
						severity: "high",
						message: "risky diff",
					},
				]);
			},
		});

		try {
			const baseUrl = `http://127.0.0.1:${server.port}`;
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: ".",
				adapters: {
					localLlm: {
						mode: "cli",
						command: "echo '{}'",
						model: "test-model",
					},
					astmend: {
						mode: "lib",
						libEntrypoint: "../Astmend/dist/index.js",
					},
					diffGuard: {
						mode: "api",
						endpoint: baseUrl,
						apiPath: "/review",
						timeoutMs: 5000,
					},
				},
			});

			const result = await reviewWithDiffGuard({
				patch: "Index: src/index.ts\\n+bad change\\n",
				config,
			});

			expect(result.blocking).toBe(true);
			expect(result.levelCounts.error).toBe(1);
			expect(result.findings[0]?.id).toBe("DG900");
		} finally {
			await server.stop(true);
		}
	});
});
