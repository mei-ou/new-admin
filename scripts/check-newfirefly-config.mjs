import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const configFile = "wrangler.newfirefly.jsonc";

function readConfig(file) {
	let source;
	try {
		source = readFileSync(file, "utf8");
	} catch {
		throw new Error(`无法读取 ${file}。请先复制参考版配置模板并填写缺项。`);
	}
	const result = ts.parseConfigFileTextToJson(file, source);
	if (
		result.error ||
		!result.config ||
		typeof result.config !== "object" ||
		Array.isArray(result.config)
	)
		throw new Error(`${file} 不是有效的 JSON/JSONC 配置。`);
	return result.config;
}

function validOrigin(value) {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
	} catch {
		return false;
	}
}

function validate(config, original) {
	const errors = [];
	if (!config.vars || typeof config.vars !== "object" || Array.isArray(config.vars))
		return ["vars 必须是配置对象。"];
	for (const key of ["d1_databases", "ratelimits"]) {
		if (
			!Array.isArray(config[key]) ||
			config[key].some((item) => !item || typeof item !== "object" || Array.isArray(item))
		)
			return [`${key} 必须是绑定对象数组。`];
	}
	const vars = config.vars ?? {};
	const require = (condition, message) => {
		if (!condition) errors.push(message);
	};
	function placeholders(value, path = "配置") {
		if (typeof value === "string" && /REPLACE_WITH_/i.test(value))
			errors.push(`${path} 仍是待填写占位项。`);
		else if (value && typeof value === "object")
			for (const [key, child] of Object.entries(value)) placeholders(child, `${path}.${key}`);
	}
	placeholders(config);
	require(typeof config.name === "string" && /^[a-z0-9-]+$/.test(config.name), "Worker 名称无效。");
	require(config.name !== original.name, "不能使用旧后台的 Worker 名称。");
	require(vars.SITE_ID === "newfirefly", "SITE_ID 必须是 newfirefly。");
	require(vars.APP_ENV === "production", "APP_ENV 必须是 production。");
	require(!vars.LOCAL_PREVIEW ||
		vars.LOCAL_PREVIEW === "false", "生产配置不能启用 LOCAL_PREVIEW。");
	require(!config.env ||
		Object.keys(config.env).length === 0, "专用配置不支持 env 覆盖，请直接填写顶层配置。");
	require(vars.GITHUB_OWNER === "mei-ou" &&
		vars.GITHUB_REPO === "newfirefly", "目标仓库必须是已确认的 mei-ou/newfirefly。");
	require(typeof vars.GITHUB_BRANCH === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(vars.GITHUB_BRANCH) &&
		!/\.\.|\/\/|\.lock$|\/$/.test(vars.GITHUB_BRANCH), "GITHUB_BRANCH 未填写或格式无效。");
	require(vars.GITHUB_CONTENT_ROOT === "src/content/posts", "文章目录必须是 src/content/posts。");
	require(validOrigin(vars.ADMIN_ORIGIN), "ADMIN_ORIGIN 必须是无路径的 HTTPS 域名。");
	require(vars.ADMIN_ORIGIN !== original.vars?.ADMIN_ORIGIN, "新后台不能使用旧后台的域名。");
	require(typeof vars.ACCESS_TEAM_DOMAIN === "string" &&
		/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(
			vars.ACCESS_TEAM_DOMAIN,
		), "ACCESS_TEAM_DOMAIN 未填写或格式无效。");
	require(typeof vars.ACCESS_AUDIENCE === "string" &&
		vars.ACCESS_AUDIENCE.trim().length > 0, "ACCESS_AUDIENCE 未填写。");
	const emails =
		typeof vars.ACCESS_ALLOWED_EMAILS === "string"
			? vars.ACCESS_ALLOWED_EMAILS.split(",")
					.map((email) => email.trim())
					.filter(Boolean)
			: [];
	const subjects =
		typeof vars.ACCESS_ALLOWED_SUBJECTS === "string"
			? vars.ACCESS_ALLOWED_SUBJECTS.split(",")
					.map((subject) => subject.trim())
					.filter(Boolean)
			: [];
	require(emails.length + subjects.length > 0, "至少填写一个允许登录的邮箱或主体。");
	require(emails.every((email) =>
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
	), "允许登录的邮箱格式无效。");
	for (const key of ["GITHUB_TOKEN", "IMAGEBED_API_TOKEN"])
		require(!(key in vars), `${key} 只能通过 Secret 配置，不能写进 vars。`);
	require(validOrigin(vars.IMAGEBED_BASE_URL), "IMAGEBED_BASE_URL 必须是无路径的 HTTPS 域名。");
	require(typeof vars.IMAGEBED_UPLOAD_FOLDER === "string" &&
		vars.IMAGEBED_UPLOAD_FOLDER.length <= 200 &&
		/^([A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(
			vars.IMAGEBED_UPLOAD_FOLDER,
		), "IMAGEBED_UPLOAD_FOLDER 格式无效。");
	if (vars.IMAGEBED_UPLOAD_CHANNEL !== undefined)
		require(["telegram", "cfr2", "s3", "discord", "huggingface", "webdav"].includes(
			vars.IMAGEBED_UPLOAD_CHANNEL,
		), "IMAGEBED_UPLOAD_CHANNEL 不受支持。");
	for (const key of [
		"FEATURE_IMAGEBED_UPLOAD",
		"FEATURE_COVER_MANAGEMENT",
		"FEATURE_ARTICLE_DELETE",
	])
		require(vars[key] === "true", `${key} 必须开启。`);
	for (const key of [
		"FEATURE_SMALL_IMAGE_UPLOAD",
		"FEATURE_PDF_ATTACHMENT_UPLOAD",
		"FEATURE_ARTICLE_ASSET_DETAILS",
		"FEATURE_ARTICLE_ASSET_RENAME",
	])
		require(vars[key] === "false", `${key} 必须关闭。`);
	const databases = config.d1_databases ?? [];
	const database = databases.find((item) => item.binding === "IDEMPOTENCY_DB");
	require(databases.length === 1 && database, "需要唯一的 IDEMPOTENCY_DB 数据库绑定。");
	require(typeof database?.database_id === "string" &&
		/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
			database.database_id,
		), "新 D1 database_id 未填写或格式无效。");
	require(!original.d1_databases?.some(
		(item) => item.database_id === database?.database_id,
	), "新后台不能共用旧后台的 D1。");
	const limiter = config.ratelimits?.find((item) => item.name === "RATE_LIMITER");
	require(limiter &&
		/^\d+$/.test(String(limiter.namespace_id)) &&
		Number(limiter.simple?.limit) > 0 &&
		[10, 60].includes(limiter.simple?.period), "RATE_LIMITER 配置缺失或无效。");
	require(!original.ratelimits?.some(
		(item) => String(item.namespace_id) === String(limiter?.namespace_id),
	), "新后台不能共用旧后台的限流编号。");
	return errors;
}

function assertNoErrors(errors) {
	if (errors.length)
		throw new Error(
			`参考版配置检查未通过：\n${[...new Set(errors)].map((error) => `- ${error}`).join("\n")}`,
		);
}

export function checkNewfireflyConfig({ built = false } = {}) {
	const config = readConfig(configFile);
	const original = readConfig("wrangler.jsonc");
	const errors = validate(config, original);
	assertNoErrors(errors);
	if (built) {
		const artifact = readConfig("dist/server/wrangler.json");
		errors.push(...validate(artifact, original).map((error) => `构建产物：${error}`));
		assertNoErrors(errors);
		for (const key of ["name", "compatibility_date", "compatibility_flags"])
			if (JSON.stringify(config[key]) !== JSON.stringify(artifact[key]))
				errors.push(`构建产物 ${key} 与参考版配置不一致。`);
		for (const [key, value] of Object.entries(config.vars ?? {}))
			if (JSON.stringify(value) !== JSON.stringify(artifact.vars?.[key]))
				errors.push(`构建产物 vars.${key} 与参考版配置不一致。`);
		for (const [key, identity] of [
			["d1_databases", "binding"],
			["ratelimits", "name"],
		]) {
			const expected = config[key] ?? [];
			const actual = artifact[key] ?? [];
			if (expected.length !== actual.length) errors.push(`构建产物 ${key} 绑定数量不一致。`);
			for (const item of expected) {
				const counterpart = actual.find((entry) => entry[identity] === item[identity]);
				for (const field of key === "d1_databases"
					? ["database_id", "database_name"]
					: ["namespace_id", "simple"])
					if (JSON.stringify(item[field]) !== JSON.stringify(counterpart?.[field]))
						errors.push(`构建产物 ${key}.${field} 与参考版配置不一致。`);
			}
		}
	}
	assertNoErrors(errors);
	console.log(`参考版${built ? "构建产物" : "本地配置"}检查通过。`);
	console.log(
		"此检查不读取 Token、不连接网络、不验证 Access 策略或 Secret、不迁移数据库、不部署。",
	);
	return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		if (process.argv.slice(2).some((argument) => argument !== "--built" && argument !== "--"))
			throw new Error("仅支持 --built 参数。");
		checkNewfireflyConfig({ built: process.argv.includes("--built") });
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
