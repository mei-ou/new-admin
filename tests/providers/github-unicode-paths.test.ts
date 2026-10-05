import { describe, expect, it, vi } from "vitest";
import { createGitHubRepositoryFactory } from "../../src/providers/git/github-factory";
import { GitHubProvider } from "../../src/providers/git/github-provider";

const fileSha = "a".repeat(40);
const headSha = "b".repeat(40);
const treeSha = "c".repeat(40);
const commitSha = "d".repeat(40);
const directory = "src/content/posts";
const articlePath = `${directory}/博客指南/博客使用指南.md`;
const commitUrl = `https://github.com/mei-ou/newfirefly/commit/${commitSha}`;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function repository(fetchMock: typeof fetch, site = "newfirefly") {
	return createGitHubRepositoryFactory({
		readEnv: () => ({
			SITE_ID: site,
			GITHUB_OWNER: "mei-ou",
			GITHUB_REPO: "newfirefly",
			GITHUB_BRANCH: "main",
			GITHUB_CONTENT_ROOT: directory,
			GITHUB_TOKEN: "test-token",
		}),
		fetch: fetchMock,
	}).create();
}

describe("GitHub 中文文章路径的真实 Provider 链路", () => {
	it("生产工厂传入 Unicode 策略，接受真实根目录的中文分类", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			json([
				{ name: "博客指南", path: `${directory}/博客指南`, sha: fileSha, type: "dir", size: 0 },
				{ name: "测试", path: `${directory}/测试`, sha: treeSha, type: "dir", size: 0 },
			]),
		);
		const result = await repository(fetchMock).provider.listDirectory(directory);
		expect(result.map((entry) => entry.name)).toEqual(["博客指南", "测试"]);
	});
	it("中文分类快照、空格标点文件名和文件读取使用编码 URL", async () => {
		const path = `${directory}/博客指南/我的文章 (2026).md`;
		const markdown = "# 博客使用指南\n";
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				json([{ name: "我的文章 (2026).md", path, sha: fileSha, type: "file", size: 16 }]),
			)
			.mockResolvedValueOnce(
				json({
					type: "file",
					path,
					sha: fileSha,
					encoding: "base64",
					content: Buffer.from(markdown).toString("base64"),
					size: Buffer.byteLength(markdown),
				}),
			);
		const provider = repository(fetchMock).provider;
		await expect(
			provider.listDirectoryAtCommit(`${directory}/博客指南`, headSha),
		).resolves.toHaveLength(1);
		await expect(provider.getFileAtCommit(path, headSha)).resolves.toMatchObject({
			path,
			content: markdown,
		});
		const request = fetchMock.mock.calls[1]?.[0] as URL;
		expect(request.pathname).toContain(encodeURIComponent("博客指南"));
		expect(decodeURIComponent(request.pathname)).toContain(path);
		expect(request.searchParams.get("ref")).toBe(headSha);
	});
	it("中文路径单文件写入不会改变目标路径", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				json({
					content: { path: articlePath, sha: fileSha },
					commit: { sha: commitSha, html_url: commitUrl },
				}),
			);
		await expect(
			repository(fetchMock).provider.createFile({
				path: articlePath,
				content: "# 正文",
				message: "docs: create article",
			}),
		).resolves.toMatchObject({ filePath: articlePath });
		expect(decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]))).toContain(articlePath);
	});
	it.each(["write", "delete"])(
		"中文路径原子 %s 支持 Git Tree，并保持禁止强制更新",
		async (operation) => {
			const responses = [
				json({ object: { type: "commit", sha: headSha } }),
				json({ sha: headSha, html_url: commitUrl, tree: { sha: treeSha } }),
				json({ type: "file", path: articlePath, sha: fileSha }),
				...(operation === "write" ? [json({ sha: fileSha })] : []),
				json({ sha: treeSha }),
				json({ sha: commitSha, html_url: commitUrl }),
				json({ object: { type: "commit", sha: commitSha } }),
			];
			const fetchMock = vi.fn<typeof fetch>();
			for (const response of responses) fetchMock.mockResolvedValueOnce(response);
			const result = await repository(fetchMock).provider.commitFilesAtomically({
				expectedHeadSha: headSha,
				message: "docs: update article",
				files:
					operation === "write"
						? [{ path: articlePath, content: "# 正文", expectedSha: fileSha }]
						: [{ operation: "delete", path: articlePath, expectedSha: fileSha }],
				checkpointCandidateCommit: async () => {},
			});
			expect(result.files).toEqual([
				{ path: articlePath, fileSha: operation === "write" ? fileSha : null },
			]);
			const treeRequest = fetchMock.mock.calls.find(([url]) =>
				(url as URL).pathname.endsWith("/git/trees"),
			);
			expect(JSON.parse(String(treeRequest?.[1]?.body)).tree[0].path).toBe(articlePath);
			const refRequest = fetchMock.mock.calls.at(-1);
			expect(JSON.parse(String(refRequest?.[1]?.body))).toEqual({ sha: commitSha, force: false });
		},
	);
	it("旧站和默认 Provider 仍拒绝中文输入且不访问网络", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		const legacy = repository(fetchMock, "firefly").provider;
		const defaultProvider = new GitHubProvider(
			{ owner: "mei-ou", repo: "newfirefly", branch: "main", token: "test-token" },
			{ fetch: fetchMock },
		);
		for (const provider of [legacy, defaultProvider])
			await expect(provider.getFile(articlePath)).rejects.toThrow(TypeError);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("Unicode 模式仍拒绝穿越、百分号、不可见字符和非规范路径", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		const provider = repository(fetchMock).provider;
		for (const name of [
			"../secret",
			"%2e%2e",
			"目录\\文件",
			"目录:文件",
			"隐藏\u200b文件",
			"ＡＢＣ",
			"con",
			"目录//文章",
		])
			await expect(provider.getFile(`${directory}/${name}.md`)).rejects.toThrow(TypeError);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
