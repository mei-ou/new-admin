import { z } from "zod";
import {
	buildConfiguredWrite,
	createEditorValues,
} from "../components/articles/configured-editor-state";
import { createFrontmatterCodec } from "../modules/articles/article-schema";
import { createArticleEditorConfig } from "../modules/articles/editor-config";
import {
	commitArticleDelete,
	prepareArticleDelete,
} from "../modules/articles/services/delete-article";
import { listArticles } from "../modules/articles/services/list-articles";
import { readArticle } from "../modules/articles/services/read-article";
import { createArticle, updateArticle } from "../modules/articles/services/write-article";
import type { GitDirectoryEntry, GitProvider, GitRepositoryFile } from "../providers/git/types";
import { getSoleContentType, toArticlePathConfig } from "../sites";
import type { SiteConfig } from "../sites/types";
import type { AdminCapabilitySnapshot } from "../types/capability";
import { buildMarkdownDocument } from "../utils/frontmatter-utils";
import { ApiError } from "./http/errors";
import { jsonResponse } from "./http/response";
import { parseIdempotencyKey } from "./security/idempotency";
import { enforceWriteRequestPolicy, isWriteMethod } from "./security/origin-policy";
import { buildArticlePath, parseArticlePath } from "./security/path-policy";

type PreviewProvider = Pick<
	GitProvider,
	| "getFile"
	| "getFileAtCommit"
	| "getHead"
	| "listDirectory"
	| "listDirectoryAtCommit"
	| "commitFilesAtomically"
>;
const writeSchema = z
	.object({
		storageSlug: z.string().optional(),
		expectedHeadSha: z.string().regex(/^[a-f0-9]{40,64}$/),
		expectedSha: z
			.string()
			.regex(/^[a-f0-9]{40,64}$/)
			.optional(),
		article: z.unknown().optional(),
		action: z.enum(["draft", "publish"]).optional(),
	})
	.strict();

function response(payload: unknown, status = 200) {
	const result = jsonResponse(payload, status);
	result.headers.set("X-Firefly-Local-Preview", "true");
	return result;
}

export function createConfiguredLocalPreview(site: SiteConfig) {
	const type = getSoleContentType(site);
	const codec = createFrontmatterCodec(type);
	const pathConfig = toArticlePathConfig(type, site.contentRoot);
	let sequence = 1;
	function nextSha() {
		return (sequence++).toString(16).padStart(40, "0");
	}
	let headSha = nextSha();
	let files = new Map<string, GitRepositoryFile>();
	const snapshots = new Map<string, Map<string, GitRepositoryFile>>();
	const requests = new Map<string, { fingerprint: string; result: Promise<unknown> }>();
	const config = createArticleEditorConfig(site.id, type);
	for (const id of ["博客指南/本地预览文章", "博客指南/邻接文章"]) {
		const values = createEditorValues(config);
		values.title = id.split("/").at(-1) ?? id;
		const article = buildConfiguredWrite(
			config,
			id,
			values,
			"# 本地预览\n\n这里只修改内存模拟文章，不会提交到 GitHub。\n",
			"",
		).article;
		const path = buildArticlePath(id, pathConfig);
		files.set(path, {
			path,
			sha: nextSha(),
			content: buildMarkdownDocument(codec, article.frontmatter, article.markdown),
			encoding: "utf-8",
		});
	}
	snapshots.set(headSha, new Map(files));
	function snapshot(sha: string) {
		const value = snapshots.get(sha);
		if (!value) throw new ApiError(404, "NOT_FOUND", "预览版本不存在。");
		return value;
	}
	function fileAt(path: string, sha: string) {
		const file = snapshot(sha).get(path);
		if (!file) throw new ApiError(404, "NOT_FOUND", "预览文章不存在。");
		return { ...file };
	}
	function directoryAt(path: string, sha: string): GitDirectoryEntry[] {
		const entries = new Map<string, GitDirectoryEntry>();
		for (const file of snapshot(sha).values()) {
			if (!file.path.startsWith(`${path}/`)) continue;
			const relative = file.path.slice(path.length + 1);
			const name = relative.split("/")[0];
			if (!name) continue;
			const directory = relative.includes("/");
			entries.set(name, {
				name,
				path: `${path}/${name}`,
				sha: file.sha,
				type: directory ? "directory" : "file",
				size: directory ? null : new TextEncoder().encode(file.content).length,
			});
		}
		return [...entries.values()];
	}
	const provider: PreviewProvider = {
		getFile: async (path) => fileAt(path, headSha),
		getFileAtCommit: async (path, sha) => fileAt(path, sha),
		getHead: async () => ({
			commitSha: headSha,
			treeSha: headSha,
			commitUrl: `https://github.com/local-preview/simulation/commit/${headSha}`,
		}),
		listDirectory: async (path) => directoryAt(path, headSha),
		listDirectoryAtCommit: async (path, sha) => directoryAt(path, sha),
		commitFilesAtomically: async (input) => {
			if (input.expectedHeadSha !== headSha)
				throw new ApiError(409, "CONFLICT", "模拟版本已变化，请重新打开文章。");
			if (snapshots.size >= 100)
				throw new ApiError(429, "RATE_LIMITED", "预览操作达到上限，请重启本地服务。");
			const changes = new Map(files);
			for (const change of input.files) {
				parseArticlePath(change.path, pathConfig);
				if ((files.get(change.path)?.sha ?? null) !== change.expectedSha)
					throw new ApiError(409, "CONFLICT", "模拟文章版本已变化。");
				if (change.operation === "delete") changes.delete(change.path);
				else if (change.operation === "reuse" || typeof change.content !== "string")
					throw new ApiError(400, "INVALID_REQUEST", "本地预览不处理资源变更。");
				else
					changes.set(change.path, {
						path: change.path,
						sha: nextSha(),
						content: change.content,
						encoding: "utf-8",
					});
			}
			const commitSha = nextSha();
			await input.checkpointCandidateCommit(commitSha);
			if (input.expectedHeadSha !== headSha)
				throw new ApiError(409, "CONFLICT", "模拟版本已变化。");
			files = changes;
			headSha = commitSha;
			snapshots.set(headSha, new Map(files));
			return {
				commitSha,
				commitUrl: `https://github.com/local-preview/simulation/commit/${commitSha}`,
				files: input.files.map((entry) => ({
					path: entry.path,
					fileSha: files.get(entry.path)?.sha ?? null,
				})),
			};
		},
	};
	const checkpointCandidateCommit = async () => undefined;
	const dependencies = { gitProvider: provider, pathConfig, codec, checkpointCandidateCommit };

	return async (request: Request, capabilities: AdminCapabilitySnapshot): Promise<Response> => {
		const url = new URL(request.url);
		if (url.pathname === "/api/articles" && request.method === "GET") {
			const articles = await listArticles(
				{
					page: url.searchParams.get("page") ?? undefined,
					pageSize: url.searchParams.get("pageSize") ?? undefined,
					query: url.searchParams.get("query") ?? undefined,
				},
				dependencies,
			);
			return response({ articles });
		}
		const prefix = "/api/articles/";
		const id = url.pathname.startsWith(prefix)
			? url.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/")
			: undefined;
		const path = id === undefined ? undefined : buildArticlePath(id, pathConfig);
		if (request.method === "HEAD" && path)
			return new Response(null, {
				status: files.has(path) ? 200 : 404,
				headers: {
					"Cache-Control": "no-store",
					"X-Firefly-Local-Preview": "true",
					"X-Repository-Head-Sha": headSha,
				},
			});
		if (request.method === "GET" && id)
			return response({
				article: await readArticle(id, { ...dependencies, requireHeadSnapshot: true }),
			});
		if (!isWriteMethod(request.method))
			throw new ApiError(404, "NOT_FOUND", "本地预览未提供此接口。");
		enforceWriteRequestPolicy(request, url.origin);
		const key = parseIdempotencyKey(request);
		const raw = await request.text();
		if (raw.length > 1_100_000) throw new ApiError(413, "INVALID_REQUEST", "模拟请求过大。");
		const body = writeSchema.parse(JSON.parse(raw));
		const fingerprint = `${request.method}:${url.pathname}:${raw}`;
		const existing = requests.get(key);
		if (existing && existing.fingerprint !== fingerprint)
			throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "模拟幂等键已用于其他请求。");
		if (existing) return response(await existing.result);
		async function execute() {
			if (request.method === "DELETE" && id) {
				if (!capabilities.articleDelete) throw new ApiError(404, "NOT_FOUND", "删除能力已关闭。");
				const plan = await prepareArticleDelete(
					id,
					body.expectedHeadSha,
					body.expectedSha,
					dependencies,
				);
				return { deletion: await commitArticleDelete(plan, dependencies) };
			}
			if (!body.action) throw new ApiError(400, "INVALID_REQUEST", "缺少模拟发布动作。");
			const article = codec.editorInputSchema.parse(body.article);
			if (article.frontmatter.draft !== (body.action === "draft"))
				throw new ApiError(400, "INVALID_REQUEST", "模拟发布动作与草稿状态不一致。");
			if (request.method === "POST" && url.pathname === "/api/articles")
				return {
					article: await createArticle(
						body.storageSlug,
						body.expectedHeadSha,
						article,
						dependencies,
					),
				};
			if (request.method === "PUT" && id)
				return {
					article: await updateArticle(
						id,
						body.expectedHeadSha,
						body.expectedSha,
						article,
						dependencies,
					),
				};
			throw new ApiError(404, "NOT_FOUND", "本地预览未提供此接口。");
		}
		const result = execute();
		requests.set(key, { fingerprint, result });
		try {
			return response(await result);
		} catch (error) {
			requests.delete(key);
			throw error;
		}
	};
}
