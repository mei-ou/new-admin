import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function configuration() {
	return {
		name: "newfirefly-admin",
		compatibility_date: "2026-08-11",
		compatibility_flags: ["nodejs_compat"],
		vars: {
			APP_ENV: "production",
			SITE_ID: "newfirefly",
			LOCAL_PREVIEW: "false",
			GITHUB_OWNER: "mei-ou",
			GITHUB_REPO: "newfirefly",
			GITHUB_BRANCH: "main",
			GITHUB_CONTENT_ROOT: "src/content/posts",
			ADMIN_ORIGIN: "https://blog-admin.example.com",
			ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
			ACCESS_AUDIENCE: "audience",
			ACCESS_ALLOWED_EMAILS: "owner@example.com",
			ACCESS_ALLOWED_SUBJECTS: "",
			IMAGEBED_BASE_URL: "https://pic.example.com",
			IMAGEBED_UPLOAD_FOLDER: "newfirefly-blog",
			FEATURE_IMAGEBED_UPLOAD: "true",
			FEATURE_COVER_MANAGEMENT: "true",
			FEATURE_ARTICLE_DELETE: "true",
			FEATURE_SMALL_IMAGE_UPLOAD: "false",
			FEATURE_PDF_ATTACHMENT_UPLOAD: "false",
			FEATURE_ARTICLE_ASSET_DETAILS: "false",
			FEATURE_ARTICLE_ASSET_RENAME: "false",
		},
		d1_databases: [
			{
				binding: "IDEMPOTENCY_DB",
				database_name: "new-db",
				database_id: "123e4567-e89b-42d3-a456-426614174000",
			},
		],
		ratelimits: [{ name: "RATE_LIMITER", namespace_id: "1002", simple: { limit: 60, period: 60 } }],
	};
}

const original = {
	name: "firefly-admin",
	vars: { ADMIN_ORIGIN: "https://admin.example.com" },
	d1_databases: [{ database_id: "123e4567-e89b-42d3-a456-426614174001" }],
	ratelimits: [{ namespace_id: "1001" }],
};
type Config = ReturnType<typeof configuration>;

function check(
	mutate: (config: Config) => void = () => {},
	options: {
		built?: Config;
		missing?: boolean;
		raw?: string;
		build?: boolean;
		stubBuild?: boolean;
		budgetFailure?: boolean;
	} = {},
) {
	const root = mkdtempSync(join(tmpdir(), "newfirefly-config-"));
	try {
		const config = configuration();
		mutate(config);
		writeFileSync(join(root, "wrangler.jsonc"), JSON.stringify(original));
		if (!options.missing)
			writeFileSync(
				join(root, "wrangler.newfirefly.jsonc"),
				options.raw ?? `// 配置\n${JSON.stringify(config)}`,
			);
		if (options.built) {
			mkdirSync(join(root, "dist", "server"), { recursive: true });
			writeFileSync(join(root, "dist", "server", "wrangler.json"), JSON.stringify(options.built));
		}
		if (options.stubBuild) {
			mkdirSync(join(root, "node_modules", "astro", "bin"), { recursive: true });
			mkdirSync(join(root, "scripts"), { recursive: true });
			writeFileSync(
				join(root, "node_modules", "astro", "bin", "astro.mjs"),
				`
import { mkdirSync, writeFileSync } from "node:fs";
if (process.argv[2] !== "build" || process.env.ADMIN_WRANGLER_CONFIG !== "wrangler.newfirefly.jsonc") process.exit(2);
mkdirSync("dist/server", { recursive: true });
writeFileSync("dist/server/wrangler.json", ${JSON.stringify(JSON.stringify(options.built ?? config))});
console.log("模拟构建完成");
`,
			);
			writeFileSync(
				join(root, "scripts", "check-milkdown-budget.mjs"),
				options.budgetFailure ? "process.exit(1);" : 'console.log("模拟体积检查通过");',
			);
		}
		const script = resolve(
			options.build ? "scripts/build-newfirefly.mjs" : "scripts/check-newfirefly-config.mjs",
		);
		const result = spawnSync(
			process.execPath,
			[script, ...(options.built && !options.build ? ["--built"] : [])],
			{
				cwd: root,
				encoding: "utf8",
				env: { ...process.env, ADMIN_WRANGLER_CONFIG: "wrangler.jsonc" },
			},
		);
		return { status: result.status, output: result.stdout + result.stderr };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe("参考版部署前只读检查", () => {
	it("接受 JSONC 和未来的新域名，不把域名写死", () => {
		expect(
			check((config) => {
				config.vars.ADMIN_ORIGIN = "https://future.example.com";
			}).status,
		).toBe(0);
	});
	it("配置未创建时给出提示并停止专用构建", () => {
		const result = check(undefined, { missing: true, build: true });
		expect(result.status).toBe(1);
		expect(result.output).toContain("先复制参考版配置模板");
		expect(result.output).not.toContain("Cannot find module");
	});
	it("占位项不能通过检查", () => {
		const result = check((config) => {
			config.vars.ACCESS_AUDIENCE = "REPLACE_WITH_AUDIENCE";
		});
		expect(result.status).toBe(1);
		expect(result.output).toContain("占位项");
	});
	it.each(["name", "domain", "database", "limiter"])("防止复用旧后台的 %s", (field) => {
		const result = check((config) => {
			if (field === "name") config.name = original.name;
			if (field === "domain") config.vars.ADMIN_ORIGIN = original.vars.ADMIN_ORIGIN;
			if (field === "database")
				config.d1_databases = [
					{
						binding: "IDEMPOTENCY_DB",
						database_name: "new-db",
						database_id: "123e4567-e89b-42d3-a456-426614174001",
					},
				];
			if (field === "limiter")
				config.ratelimits = [
					{ name: "RATE_LIMITER", namespace_id: "1001", simple: { limit: 60, period: 60 } },
				];
		});
		expect(result.status).toBe(1);
		expect(result.output).toContain("旧后台");
	});
	it("拒绝参考作者仓库、预览模式和缺少允许登录账号", () => {
		const result = check((config) => {
			config.vars.GITHUB_OWNER = "tianshihao2003";
			config.vars.LOCAL_PREVIEW = "true";
			config.vars.ACCESS_ALLOWED_EMAILS = "";
		});
		expect(result.status).toBe(1);
		expect(result.output).toContain("目标仓库");
		expect(result.output).toContain("LOCAL_PREVIEW");
		expect(result.output).toContain("允许登录");
	});
	it("拒绝 vars 中的 Token，错误信息不输出 Token", () => {
		const result = check((config) => {
			Object.assign(config.vars, { GITHUB_TOKEN: "sensitive-value-do-not-display" });
		});
		expect(result.status).toBe(1);
		expect(result.output).toContain("只能通过 Secret");
		expect(result.output).not.toContain("sensitive-value-do-not-display");
	});
	it("接受与选择配置一致的构建产物", () => {
		expect(check(undefined, { built: configuration() }).status).toBe(0);
	});
	it("拒绝旧站产物或不同分支的过期产物", () => {
		const artifact = configuration();
		artifact.vars.GITHUB_BRANCH = "stale-branch";
		const result = check(undefined, { built: artifact });
		expect(result.status).toBe(1);
		expect(result.output).toContain("vars.GITHUB_BRANCH 与参考版配置不一致");
	});
	it("拒绝无效 JSON，不把原始文件内容输出", () => {
		const result = check(undefined, { raw: "{ sensitive-value-do-not-display" });
		expect(result.status).toBe(1);
		expect(result.output).toContain("不是有效的 JSON/JSONC");
		expect(result.output).not.toContain("sensitive-value-do-not-display");
	});
	it("拒绝错误的配置结构，不把错误字段值输出", () => {
		const result = check(undefined, {
			raw: JSON.stringify({ vars: "sensitive-value-do-not-display" }),
		});
		expect(result.status).toBe(1);
		expect(result.output).toContain("vars 必须是配置对象");
		expect(result.output).not.toContain("sensitive-value-do-not-display");
	});
	it("专用构建强制选择新配置并依次检查产物，不执行部署", () => {
		const result = check(undefined, { build: true, stubBuild: true });
		expect(result.status).toBe(0);
		expect(result.output).toContain("模拟体积检查通过");
		expect(result.output).toContain("构建产物检查通过");
		expect(result.output).toContain("尚未部署");
	});
	it("体积检查失败时不报告构建成功或继续部署", () => {
		const result = check(undefined, { build: true, stubBuild: true, budgetFailure: true });
		expect(result.status).toBe(1);
		expect(result.output).toContain("没有执行部署");
		expect(result.output).not.toContain("参考版构建完成");
	});
	it("构建后产物分支不一致时停止专用构建", () => {
		const artifact = configuration();
		artifact.vars.GITHUB_BRANCH = "wrong-branch";
		const result = check(undefined, { build: true, stubBuild: true, built: artifact });
		expect(result.status).toBe(1);
		expect(result.output).toContain("vars.GITHUB_BRANCH 与参考版配置不一致");
		expect(result.output).not.toContain("参考版构建完成");
	});
});
