import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/check-milkdown-budget.mjs");
const chunks = [
	"core",
	"commonmark",
	"gfm",
	"history",
	"listener",
	"bridge",
	"firefly-source-node",
];

function fixture(overrides: Record<string, string> = {}) {
	const root = mkdtempSync(join(tmpdir(), "milkdown-budget-"));
	const directory = join(root, "dist", "client", "_astro");
	mkdirSync(directory, { recursive: true });
	const sources: Record<string, string> = {
		"ArticleEditor.test.js": 'import "./shared.test.js";',
		"ConfiguredArticleEditor.test.js": 'import "./shared.test.js";',
		"shared.test.js": chunks
			.map(
				(name) =>
					`export const ${name.replaceAll("-", "_")} = () => import(\`./${name}.test.js\`);`,
			)
			.join("\n"),
		...Object.fromEntries(
			chunks.map((name) => [`${name}.test.js`, 'import "./dependency.test.js";']),
		),
		"dependency.test.js": "export const value = 1;",
		...overrides,
	};
	try {
		for (const [name, source] of Object.entries(sources))
			writeFileSync(join(directory, name), source);
		const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
		return { status: result.status, output: result.stdout + result.stderr };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe("Milkdown production bundle budget", () => {
	it("recognizes lazy template imports in shared chunks and deduplicates dependencies", () => {
		const result = fixture();
		expect(result.status).toBe(0);
		expect(result.output).toContain("8 个文件");
	});
	it("rejects missing dynamic imports in either editor", () => {
		const result = fixture({ "ConfiguredArticleEditor.test.js": "export const value = 1;" });
		expect(result.status).toBe(1);
		expect(result.output).toContain("未引用预期的 Milkdown 动态 chunk");
	});
	it("rejects Milkdown roots loaded eagerly through a static dependency", () => {
		const result = fixture({
			"ArticleEditor.test.js": 'import "./shared.test.js"; import "./core.test.js";',
		});
		expect(result.status).toBe(1);
		expect(result.output).toContain("被提前静态加载");
	});
	it("counts transitive dependencies regardless of their chunk names", () => {
		const result = fixture({
			"dependency.test.js": `export const value = "${randomBytes(600 * 1024).toString("base64")}";`,
		});
		expect(result.status).toBe(1);
		expect(result.output).toContain("超过 400 KiB gzip 预算");
	});
	it("does not treat unrelated source-editor lazy imports as loaded Milkdown dependencies", () => {
		const result = fixture({
			"dependency.test.js": 'export const sourceEditor = () => import("./source-editor.test.js");',
			"source-editor.test.js": `export const value = "${randomBytes(600 * 1024).toString("base64")}";`,
		});
		expect(result.status).toBe(0);
	});
});
