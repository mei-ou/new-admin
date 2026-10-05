import { spawnSync } from "node:child_process";
import { checkNewfireflyConfig, configFile } from "./check-newfirefly-config.mjs";

function run(script, args = []) {
	const result = spawnSync(process.execPath, [script, ...args], {
		stdio: "inherit",
		env: { ...process.env, ADMIN_WRANGLER_CONFIG: configFile },
	});
	if (result.error || result.status !== 0)
		throw new Error("构建检查中止；没有执行部署。请查看前面的错误。");
}

try {
	checkNewfireflyConfig();
	run("node_modules/astro/bin/astro.mjs", ["build"]);
	run("scripts/check-milkdown-budget.mjs");
	checkNewfireflyConfig({ built: true });
	console.log("参考版构建完成，尚未部署。原后台配置未修改。");
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
