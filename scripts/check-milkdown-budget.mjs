import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const clientDirectory = join(process.cwd(), "dist", "client", "_astro");
const budgetBytes = 400 * 1024;
const requiredPrefixes = [
	"core.",
	"commonmark.",
	"gfm.",
	"history.",
	"listener.",
	"bridge.",
	"firefly-source-node.",
];

let files;
try {
	files = readdirSync(clientDirectory).filter((name) => name.endsWith(".js"));
} catch {
	throw new Error("找不到生产客户端构建产物，请先运行 pnpm build。");
}

const editorEntries = ["ArticleEditor.", "ConfiguredArticleEditor."].map((prefix) => {
	const entry = files.find((name) => name.startsWith(prefix));
	if (!entry) throw new Error(`生产构建缺少 ${prefix} 客户端 chunk。`);
	return entry;
});
const graph = new Map();
for (const name of files) {
	const source = ts.createSourceFile(
		name,
		readFileSync(join(clientDirectory, name), "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	const edges = { static: [], dynamic: [] };
	function addEdge(specifier, kind) {
		if (!specifier || !ts.isStringLiteralLike(specifier)) return;
		if (!specifier.text.startsWith("./") && !specifier.text.startsWith("../")) return;
		const target = posix.normalize(posix.join(posix.dirname(name), specifier.text));
		if (!files.includes(target)) throw new Error(`客户端 chunk 引用缺失：${name} → ${target}`);
		edges[kind].push(target);
	}
	function visit(node) {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			addEdge(node.moduleSpecifier, "static");
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
			addEdge(node.arguments[0], "dynamic");
		ts.forEachChild(node, visit);
	}
	visit(source);
	graph.set(name, edges);
}
function closure(entries) {
	const visited = new Set();
	const pending = [...entries];
	while (pending.length) {
		const name = pending.pop();
		if (visited.has(name)) continue;
		visited.add(name);
		const edges = graph.get(name);
		pending.push(...edges.static);
	}
	return visited;
}
const dynamicRoots = new Set();
for (const entry of editorEntries) {
	const initialFiles = closure([entry]);
	const dynamicTargets = new Set([...initialFiles].flatMap((name) => graph.get(name).dynamic));
	for (const prefix of requiredPrefixes) {
		const targets = [...dynamicTargets].filter((name) => name.startsWith(prefix));
		if (!targets.length) throw new Error(`${entry} 未引用预期的 Milkdown 动态 chunk：${prefix}`);
		for (const target of targets) {
			if (initialFiles.has(target))
				throw new Error(`Milkdown chunk 被提前静态加载：${entry} → ${target}`);
			dynamicRoots.add(target);
		}
	}
}
const dynamicFiles = closure(dynamicRoots);

let rawBytes = 0;
let gzipBytes = 0;
for (const name of dynamicFiles) {
	const source = readFileSync(join(clientDirectory, name));
	rawBytes += source.byteLength;
	gzipBytes += gzipSync(source, { level: 9 }).byteLength;
}

console.log(
	`Milkdown 动态加载闭包：${(rawBytes / 1024).toFixed(1)} KiB 原始，${(gzipBytes / 1024).toFixed(1)} KiB gzip -9，${dynamicFiles.size} 个文件。`,
);
if (gzipBytes > budgetBytes) {
	throw new Error(
		`Milkdown 动态加载闭包超过 400 KiB gzip 预算：${(gzipBytes / 1024).toFixed(1)} KiB。`,
	);
}
