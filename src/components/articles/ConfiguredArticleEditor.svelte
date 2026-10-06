<script lang="ts">
import { onDestroy, onMount, tick } from "svelte";
import type { ArticleEditorConfig, EditorFieldConfig } from "../../modules/articles/editor-config";
import MilkdownEditor, {
	type MilkdownEditorHandle,
} from "../../modules/editor-core/adapters/milkdown/MilkdownEditor.svelte";
import type { AdminCapabilitySnapshot } from "../../types/capability";
import CodeMirrorEditor from "./CodeMirrorEditor.svelte";
import type { CodeMirrorEditorHandle } from "./codemirror-runtime";
import {
	articleRoute,
	buildConfiguredWrite,
	type ConfiguredPendingWrite,
	createEditorValues,
	groupConfiguredEditorFields,
	parseConfiguredArticle,
	parseConfiguredCommit,
	parseConfiguredPending,
} from "./configured-editor-state";
import EditorToolbar from "./EditorToolbar.svelte";
import {
	type BlockMarkdownCommand,
	createBlockMarkdownReplacement,
	createInlineMarkdownReplacement,
	createMarkdownImage,
	type InlineMarkdownCommand,
} from "./editor-commands";
import ImageLayoutDialog from "./ImageLayoutDialog.svelte";
import type { ImageLayout } from "../../../integrations/newfirefly/image-layout.mjs";
import { listArticleImages, prepareImageReplacement, replaceArticleImage, type ArticleImageBlock } from "./image-layout-state";
import { uploadImageBedImage } from "./imagebed-client";
import SpecialBlockDialog from "./SpecialBlockDialog.svelte";
import ConfiguredLinkDialog from "./ConfiguredLinkDialog.svelte";
import type { LinkStyle } from "./link-style";
import { insertSpecialBlock, listSpecialBlocks, readSpecialBlock, replaceSpecialBlock, SPECIAL_BLOCK_LABELS, type SpecialBlockFields, type SpecialBlockNode } from "./special-block-state";

interface Props {
	mode: "create" | "edit";
	storageId?: string;
	config: ArticleEditorConfig;
	principalId: string;
	capabilities: AdminCapabilitySnapshot;
}
let { mode, storageId = "", config, principalId, capabilities }: Props = $props();
function initialValues() {
	return createEditorValues(config);
}
let values = $state(initialValues());
let category = $state("");
let filename = $state("");
let markdown = $state("");
let headSha = $state("");
let fileSha = $state("");
let publicSlug = $state("");
let loading = $state(true);
let busy = $state(false);
let uploading = $state(false);
let message = $state("");
let source = $state(false);
let dirty = $state(false);
let imageOpen = $state(false);
let imageFields = $state<ImageLayout>({ layout: "single", width: 100, align: "center", columns: 3, images: [{ src: "", alt: "", title: "" }] });
let imageTarget = $state<ArticleImageBlock>();
let imageSnapshot = "";
let imageInsertion = { from: 0, to: 0 };
const articleImages = $derived(listArticleImages(markdown));
let linkOpen = $state(false);
let linkSelection = { from: 0, to: 0, text: "" };
let linkSelectedText = $state("");
let specialFields = $state<SpecialBlockFields>();
let specialTarget = $state<SpecialBlockNode>();
let specialSnapshot = "";
let specialInsertion = { from: 0, to: 0 };
let editorRevision = $state(0);
let pendingSourcePosition: number | undefined;
const specialBlocks = $derived(listSpecialBlocks(markdown));
let visual = $state<MilkdownEditorHandle>();
let code = $state<CodeMirrorEditorHandle>();
let pending = $state<ConfiguredPendingWrite>();
const controller = new AbortController();
let locked = $derived(
	loading ||
		busy ||
		uploading ||
		imageOpen ||
		linkOpen ||
		specialFields !== undefined ||
		pending !== undefined ||
		(mode === "edit" && !fileSha),
);
const draftKey = $derived(
	`configured-draft:${config.siteId}:${config.typeId}:${principalId}:${mode}:${storageId}`,
);
const pendingKey = $derived(`${draftKey}:pending`);
const fieldGroups = $derived(groupConfiguredEditorFields(config));
const primaryFields = $derived(fieldGroups.primary);
const toggleFields = $derived(fieldGroups.toggles);
const advancedFields = $derived(fieldGroups.advanced);

function updateMarkdown(value: string) {
	markdown = value;
	dirty = true;
}
function selection() {
	return (
		(source ? code : visual)?.getSelection() ?? {
			from: markdown.length,
			to: markdown.length,
			text: "",
		}
	);
}
function insert(text: string, target = selection()) {
	if (source) code?.replaceRange(text, target.from, target.to);
	else if (!visual?.replaceMarkdown(text, target.from, target.to))
		throw new Error("图片已上传，但插入失败。请切换源码模式后插入链接。");
	dirty = true;
}
function format(command: InlineMarkdownCommand | BlockMarkdownCommand, inline = false) {
	if (locked) return;
	if (!source) {
		visual?.runCommand(command);
		return;
	}
	const target = selection();
	const replacement = inline
		? createInlineMarkdownReplacement(command as InlineMarkdownCommand, target)
		: createBlockMarkdownReplacement(command as BlockMarkdownCommand, target);
	code?.replaceRange(
		replacement.text,
		target.from,
		target.to,
		replacement.selectionFrom,
		replacement.selectionTo,
	);
}
function switchMode() {
	if (!source && visual) {
		try { markdown = visual.flush(); }
		catch {
			if (!window.confirm("画布内容未通过源码保护校验。是否打开最近一次通过校验的源码？未通过校验的画布修改不会被带入，请先复制需要保留的文字。")) return;
			message = "已打开最近一次通过校验的源码，请核对正文再保存。";
		}
	}
	source = !source;
}
function openLink() {
	if (locked) return;
	linkSelection = selection();
	linkSelectedText = linkSelection.text;
	linkOpen = true;
}
async function insertLink(text: string, style: LinkStyle) {
	linkOpen = false;
	await tick();
	try {
		if (source) {
			if (!code) throw new Error("源码编辑器尚未就绪，请重新打开链接窗口。");
			code.replaceRange(text, linkSelection.from, linkSelection.to);
		} else {
			const success = style === "text"
				? visual?.replaceMarkdown(text, linkSelection.from, linkSelection.to)
				: visual?.insertWikiLink(text, linkSelection.from, linkSelection.to, style === "card");
			if (!success) throw new Error("链接未插入，请将光标移到普通正文中重试，或切换源码模式。");
		}
		dirty = true;
	} catch (error) { message = String(error); }
}
function openSpecialBlock(index?: number) {
	if (locked) return;
	try {
		if (!source && visual) markdown = visual.flush();
		specialSnapshot = markdown;
		specialTarget = index === undefined ? undefined : listSpecialBlocks(markdown)[index];
		if (index !== undefined && !specialTarget) throw new Error("正文已变化，请重新选择特殊块。");
		specialInsertion = source ? selection() : { from: markdown.length, to: markdown.length };
		specialFields = readSpecialBlock(specialTarget);
	} catch (error) { message = String(error); }
}
function saveSpecialBlock(replacement: string) {
	if (markdown !== specialSnapshot) throw new Error("正文已变化，请关闭并重新打开特殊块。");
	const next = specialTarget
		? replaceSpecialBlock(markdown, specialTarget, replacement)
		: insertSpecialBlock(markdown, specialInsertion.from, specialInsertion.to, replacement);
	if (source && code) {
		const range = specialTarget?.range ?? specialInsertion;
		code.replaceRange(specialTarget ? replacement : `\n\n${replacement}\n\n`, range.from, range.to);
	} else {
		markdown = next;
		editorRevision += 1;
	}
	dirty = true;
	specialFields = undefined;
}
async function showBlockSource(from: number) {
	if (locked) return;
	try {
		if (!source && visual) markdown = visual.flush();
		pendingSourcePosition = from;
		source = true;
		await tick();
		if (code) focusBlockSource(code);
	} catch (error) { message = String(error); }
}
function focusBlockSource(handle: CodeMirrorEditorHandle) {
	if (pendingSourcePosition === undefined) return;
	const from = pendingSourcePosition;
	pendingSourcePosition = undefined;
	handle.replaceRange("", from, from);
	handle.focus();
}
function insertBlankLine() {
	if (locked) return;
	try {
		if (source) {
			code?.replaceSelection("\n\n<br />\n\n");
		} else if (!visual?.replaceMarkdown("<br />\n\n<br />")) {
			throw new Error("请将光标放在普通正文段落中再插入空白行。");
		}
		dirty = true;
	} catch (error) {
		message = String(error);
	}
}
function openImage(index?: number) {
	if (locked) return;
	try {
		if (!source && visual) markdown = visual.flush();
		imageSnapshot = markdown;
		imageTarget = index === undefined ? undefined : listArticleImages(markdown)[index];
		if (index !== undefined && !imageTarget) throw new Error("图片内容已变化，请重新选择图片。");
		imageFields = imageTarget?.fields ?? { layout: "single", width: 100, align: "center", columns: 3, images: [{ src: "", alt: "", title: "" }] };
		imageInsertion = source ? selection() : { from: markdown.length, to: markdown.length };
		imageOpen = true;
	} catch (error) { message = String(error); }
}
function saveImageLayout(block: string) {
	if (markdown !== imageSnapshot) throw new Error("正文已变化，请关闭并重新打开图片窗口。");
	const replacement = imageTarget ? prepareImageReplacement(imageTarget, block) : block;
	const next = imageTarget ? replaceArticleImage(markdown, imageTarget, replacement) : insertSpecialBlock(markdown, imageInsertion.from, imageInsertion.to, replacement);
	if (source && code) {
		const range = imageTarget?.range ?? imageInsertion;
		const content = imageTarget && replacement.startsWith("![") ? replacement : `\n\n${replacement}\n${imageTarget ? "" : "\n"}`;
		code.replaceRange(content, range.from, range.to);
	} else { markdown = next; editorRevision += 1; }
	dirty = true;
	imageOpen = false;
}

async function upload(file: File, cover = false) {
	if (locked || !capabilities.imageBedUpload) return;
	const target = selection();
	uploading = true;
	let url = "";
	try {
		url = await uploadImageBedImage(file, controller.signal);
		uploading = false;
		await tick();
		if (cover) {
			values.image = url;
			dirty = true;
		} else insert(createMarkdownImage({ alt: file.name, src: url }), target);
		message = `图片已上传：${url}`;
	} catch (error) {
		message = `${String(error)}${url ? ` 图片链接：${url}` : ""}`;
	} finally {
		uploading = false;
	}
}
function pasted(event: ClipboardEvent) {
	const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
		item.type.startsWith("image/"),
	);
	if (file && capabilities.imageBedUpload && !locked) {
		event.preventDefault();
		event.stopPropagation();
		void upload(file);
	}
}
function dropped(event: DragEvent) {
	const file = Array.from(event.dataTransfer?.files ?? []).find((item) =>
		item.type.startsWith("image/"),
	);
	if (file && capabilities.imageBedUpload && !locked) {
		event.preventDefault();
		event.stopPropagation();
		void upload(file);
	}
}
function saveLocal() {
	try {
		localStorage.setItem(
			draftKey,
			JSON.stringify({
				values,
				markdown: source ? markdown : (visual?.flush() ?? markdown),
				category,
				filename,
				headSha,
				fileSha,
			}),
		);
		message = "草稿已保存在当前浏览器，未提交到博客。";
	} catch {
		message = "浏览器草稿保存失败。";
	}
}
async function load() {
	try {
		const storedPending = sessionStorage.getItem(pendingKey);
		if (storedPending)
			pending = parseConfiguredPending(JSON.parse(storedPending), config, mode, storageId);
		if (mode === "edit") {
			const response = await fetch(articleRoute(storageId, "/api/articles"), {
				signal: controller.signal,
			});
			if (!response.ok) throw new Error("文章读取失败，请刷新重试。");
			const article = parseConfiguredArticle(await response.json(), config, storageId);
			values = createEditorValues(config, article.frontmatter);
			markdown = article.markdown;
			headSha = article.headSha;
			fileSha = article.sha;
			publicSlug = article.slug ?? "";
		}
		const raw = localStorage.getItem(draftKey);
		if (raw && raw.length < 1_100_000) {
			const draft = JSON.parse(raw);
			if (
				!pending &&
				draft.headSha === headSha &&
				draft.fileSha === fileSha &&
				typeof draft.markdown === "string" &&
				draft.markdown.length <= 1_000_000 &&
				typeof draft.category === "string" &&
				typeof draft.filename === "string" &&
				draft.values &&
				config.fields.every(
					(field) =>
						typeof draft.values[field.key] === (field.kind === "boolean" ? "boolean" : "string"),
				) &&
				window.confirm("发现与当前版本匹配的浏览器草稿，是否恢复？")
			) {
				values = Object.fromEntries(
					config.fields.map((field) => [field.key, draft.values[field.key]]),
				);
				markdown = draft.markdown;
				category = draft.category;
				filename = draft.filename;
				dirty = true;
			}
		}
	} catch (error) {
		message = String(error);
	} finally {
		loading = false;
	}
}
function unload(event: BeforeUnloadEvent) {
	if (dirty || pending || uploading) {
		event.preventDefault();
		event.returnValue = "";
	}
}
async function submit(action: "draft" | "publish", deletion = false) {
	if (locked) return;
	if (
		(deletion || action === "publish") &&
		!window.confirm(
			deletion ? "确认删除这篇文章？只删除文章文件，不删除图片。" : "确认正式发布文章？",
		)
	)
		return;
	busy = true;
	try {
		if (!source && visual) markdown = visual.flush();
		const id =
			mode === "edit" ? storageId : [category.trim(), filename.trim()].filter(Boolean).join("/");
		const data = buildConfiguredWrite(
			config,
			id,
			{ ...values, draft: action === "draft" },
			markdown,
			publicSlug,
		);
		let base = headSha;
		if (mode === "create") {
			const response = await fetch(articleRoute(data.storageSlug, "/api/articles"), {
				method: "HEAD",
				signal: controller.signal,
			});
			base = response.headers.get("X-Repository-Head-Sha") ?? "";
			if (response.status !== 404 || !/^[a-f0-9]{40,64}$/.test(base))
				throw new Error(
					response.ok ? "文件名已存在，请更换文件名。" : "无法确认文件名和仓库版本，请重试。",
				);
		}
		pending = {
			url: mode === "create" ? "/api/articles" : articleRoute(id, "/api/articles"),
			method: deletion ? "DELETE" : mode === "create" ? "POST" : "PUT",
			body: JSON.stringify(
				deletion
					? { expectedHeadSha: base, expectedSha: fileSha }
					: {
							...(mode === "create" ? { storageSlug: id } : { expectedSha: fileSha }),
							expectedHeadSha: base,
							article: data.article,
							action,
						},
			),
			key: crypto.randomUUID(),
			id,
			deletion,
		};
		sessionStorage.setItem(pendingKey, JSON.stringify(pending));
	} catch (error) {
		pending = undefined;
		message = String(error);
	} finally {
		busy = false;
	}
	if (pending) await retry();
}
async function retry() {
	if (!pending || busy) return;
	busy = true;
	const request = pending;
	try {
		const response = await fetch(request.url, {
			method: request.method,
			headers: {
				"Content-Type": "application/json",
				"X-Firefly-Admin": "1",
				"Idempotency-Key": request.key,
			},
			body: request.body,
			signal: controller.signal,
		});
		const payload = await response.json();
		if (!response.ok) {
			if (
				[400, 401, 403, 404, 413, 422, 429].includes(response.status) ||
				(response.status === 409 && payload?.error?.code === "CONFLICT")
			) {
				pending = undefined;
				sessionStorage.removeItem(pendingKey);
			}
			throw new Error(
				payload?.error?.message ?? "提交状态不确定，请使用原请求重试，不要重复新建文章。",
			);
		}
		const result = parseConfiguredCommit(payload, config, request.id, request.deletion);
		pending = undefined;
		dirty = false;
		try {
			sessionStorage.removeItem(pendingKey);
		} catch {}
		try {
			localStorage.removeItem(draftKey);
		} catch {}
		if (request.deletion) {
			window.location.assign("/articles");
			return;
		}
		headSha = result.commitSha;
		fileSha = result.fileSha ?? "";
		values.draft = JSON.parse(request.body).article.frontmatter.draft;
		message = "文章已提交到仓库；前台更新还需博客部署成功。";
		if (mode === "create") window.location.assign(articleRoute(request.id));
	} catch (error) {
		message = String(error);
	} finally {
		busy = false;
	}
}
onMount(() => {
	void load();
	window.addEventListener("beforeunload", unload);
	return () => window.removeEventListener("beforeunload", unload);
});
onDestroy(() => controller.abort());
</script>

<section class="configured-editor">
 <a class="back-link" href="/articles">← 返回文章列表</a>
 {#if message}<p class="notice" role="status">{message}</p>{/if}
 {#if pending}<div class="pending-notice"><p role="alert">提交结果尚未确认，表单已锁定。待确认请求已保存在当前标签页；重试会沿用原始内容和同一幂等键。</p><button class="action-button secondary" disabled={busy || loading} onclick={retry}>重试原请求</button></div>{/if}
 <fieldset class="metadata-panel" disabled={locked}>
  <legend class="visually-hidden">文章信息</legend>
  <div class="panel-heading"><div><h2>文章信息</h2><p>填写基本信息，其他选项可以稍后设置。</p></div><span class="status-badge">{mode === "create" ? "新文章" : values.draft === true ? "草稿" : "已发布"}</span></div>
  {#if mode === "create"}
   <div class="fields identity-fields">
    <div class="field"><label for="configured-category">分类目录</label><input id="configured-category" bind:value={category} placeholder="例如：博客指南" oninput={() => dirty = true} /><p class="field-hint">可留空；多层目录用 / 分隔。</p></div>
    <div class="field"><label for="configured-filename">文章文件名</label><input id="configured-filename" bind:value={filename} placeholder="例如：我的第一篇文章" oninput={() => dirty = true} /><p class="field-hint">支持中文，不需要填写 .md。</p></div>
   </div>
  {:else}<p class="article-location">文章位置：<span>{storageId}.md</span><small>暂不支持移动或重命名</small></p>{/if}
  <div class="fields primary-fields">
   {#each primaryFields as field (field.key)}
    {@render renderField(field)}
   {/each}
  </div>
  {#if toggleFields.length}<div class="toggle-fields">{#each toggleFields as field (field.key)}{@render renderField(field)}{/each}</div>{/if}
  {#if advancedFields.length}<details class="advanced-settings"><summary>更多设置 <span>作者、语言、更新日期等</span></summary><div class="fields">{#each advancedFields as field (field.key)}{@render renderField(field)}{/each}</div></details>{/if}
 </fieldset>
 <section class="body-panel" aria-label="正文编辑">
 <div class="panel-heading"><div><h2>正文</h2><p>直接输入并排版，也可以粘贴或拖入图片。</p></div><button class="action-button secondary mode-switch" disabled={locked} onclick={switchMode}>{source ? "切换可视化编辑" : "切换 Markdown 源码"}</button></div>
 <EditorToolbar disabled={locked} showLink={capabilities.articleLinks || capabilities.externalHttpsLinks} showImage={capabilities.imageBedUpload || capabilities.externalHttpsLinks} oninline={(command) => format(command, true)} onblock={(command) => format(command)} onheading={(command) => format(command)} onlink={openLink} onimage={() => openImage()} onundo={() => (source ? code : visual)?.undo()} onredo={() => (source ? code : visual)?.redo()} onspecial={() => openSpecialBlock()} />
 <p class="field-hint">特殊块可通过表单填写；可视化模式新增到正文末尾，源码模式插入到光标位置。</p>
 {#if specialBlocks.length}<div class="special-blocks" aria-label="已有特殊块">{#each specialBlocks as block, index}<button class="action-button secondary" disabled={locked} onclick={() => openSpecialBlock(index)}>编辑{SPECIAL_BLOCK_LABELS[block.kind]}：{String(block.metadata?.title ?? block.metadata?.summary ?? block.metadata?.videoId ?? `第 ${index + 1} 块`)}</button>{/each}</div>{/if}
 {#if articleImages.length}<div class="article-image-list" aria-label="已插入图片">{#each articleImages as block, index}<button class="article-image-edit" disabled={locked} onclick={() => openImage(index)}><img src={block.fields.images[0]?.src} alt="" loading="lazy" referrerpolicy="no-referrer" /><span>编辑／换图：{block.fields.images[0]?.alt || `第 ${index + 1} 组`}<small>{block.fields.images.length} 张 · {block.fields.layout === "single" ? "单图" : "图片组"}</small></span></button>{/each}</div>{/if}
 <div class="spacing-tools"><button class="action-button secondary" disabled={locked} onclick={insertBlankLine}>插入空白行</button><p>可视化模式可连续按 Enter 留白；源码里的普通空行只分隔段落，需要显示留白时用此按钮。</p></div>
 <div class="editor-workspace" role="group" aria-label="文章正文" onpastecapture={pasted} ondropcapture={dropped} ondragover={(event) => { if (capabilities.imageBedUpload && !locked && event.dataTransfer?.types.includes("Files")) event.preventDefault(); }}>
  {#if loading}<p role="status">正在读取文章正文…</p>{:else}
  {#key editorRevision}
  {#if source}<CodeMirrorEditor value={markdown} disabled={locked} onchange={updateMarkdown} onready={(handle) => { code = handle; focusBlockSource(handle); }} ondispose={() => code = undefined} />
  {:else}<MilkdownEditor value={markdown} disabled={locked} onchange={updateMarkdown} onready={(handle) => visual = handle} ondispose={() => visual = undefined} onerror={(error) => message = error} onsource={(from) => { void showBlockSource(from); }} />{/if}
  {/key}
  {/if}
 </div>
 </section>
 <div class="actions">
  <p>草稿不会公开；发布后需等待博客部署完成。</p>
  <div class="action-buttons"><button class="action-button secondary" disabled={locked} onclick={saveLocal}>保存浏览器草稿</button>
  <button class="action-button secondary" disabled={locked} onclick={() => submit("draft")}>提交草稿</button>
  <button class="action-button primary" disabled={locked} onclick={() => submit("publish")}>发布文章</button>
  {#if mode === "edit" && capabilities.articleDelete}<button class="action-button danger" disabled={locked} onclick={() => submit("draft", true)}>删除文章</button>{/if}</div>
 </div>
 {#if imageOpen}<ImageLayoutDialog fields={imageFields} editing={imageTarget !== undefined} canUpload={capabilities.imageBedUpload} onclose={() => imageOpen = false} onsave={saveImageLayout} />{/if}
 {#if specialFields}<SpecialBlockDialog fields={specialFields} editing={specialTarget !== undefined} onsave={saveSpecialBlock} onclose={() => specialFields = undefined} />{/if}
 {#if linkOpen}<ConfiguredLinkDialog {capabilities} selectedText={linkSelectedText} oninsert={(text, style) => { void insertLink(text, style); }} onclose={() => linkOpen = false} />{/if}
</section>

{#snippet renderField(field: EditorFieldConfig)}
 <div class="field" class:wide={field.key === "title" || field.kind === "textarea" || field.kind === "image"}>
  {#if field.kind === "boolean"}<label class="toggle" for={`configured-${field.key}`}><input id={`configured-${field.key}`} type="checkbox" checked={values[field.key] === true} onchange={(event) => { values[field.key] = event.currentTarget.checked; dirty = true; }} /><span>{field.label}</span></label>
  {:else}
   <label for={`configured-${field.key}`}>{field.label}{#if field.required}<span class="required" aria-hidden="true">*</span>{/if}</label>
   {#if field.kind === "textarea"}<textarea id={`configured-${field.key}`} rows="3" value={String(values[field.key] ?? "")} oninput={(event) => { values[field.key] = event.currentTarget.value; dirty = true; }}></textarea>
   {:else if field.kind === "image"}<div class="cover-control"><input id={`configured-${field.key}`} type="text" placeholder="图片链接，或选择图片自动上传" value={String(values[field.key] ?? "")} oninput={(event) => { values[field.key] = event.currentTarget.value; dirty = true; }} />{#if capabilities.imageBedUpload && capabilities.coverManagement}<label class="upload-button" for="configured-cover-upload"><input id="configured-cover-upload" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onchange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file, true); }} />选择图片并上传</label>{/if}</div><p class="field-hint">上传后自动填入链接；支持 JPEG、PNG、WebP，最大 5 MiB。</p>
   {:else}<input id={`configured-${field.key}`} class:title-input={field.key === "title"} type={field.kind === "datetime" ? "datetime-local" : field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"} value={String(values[field.key] ?? "")} required={field.required} oninput={(event) => { values[field.key] = event.currentTarget.value; dirty = true; }} />{/if}
   {#if field.kind === "tags"}<p class="field-hint">多个标签用英文逗号分隔。</p>{/if}
  {/if}
 </div>
{/snippet}

<style>
 .article-image-list { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-block: 0.75rem; }
 .article-image-edit { display: flex; align-items: center; gap: 0.6rem; max-width: 100%; min-width: 0; padding: 0.6rem; border: 1px solid var(--border); border-radius: 0.6rem; color: var(--text-primary); background: var(--surface); font: inherit; text-align: left; cursor: pointer; }
 .article-image-edit img { width: 3rem; height: 3rem; object-fit: contain; flex: none; }
 .article-image-edit span { min-width: 0; overflow-wrap: anywhere; }
 .article-image-edit small { display: block; color: var(--text-secondary); }
 .special-blocks { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.spacing-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 0.75rem; padding: 0.75rem 0; }
	.spacing-tools p { flex: 1; min-width: 12rem; margin: 0; color: var(--text-secondary); font-size: 0.8rem; }
 .configured-editor { display: grid; min-width: 0; gap: 1.25rem; font-size: 0.875rem; }
 .back-link { justify-self: start; color: var(--text-secondary); font-size: 0.8rem; text-decoration: none; }
 .back-link:hover { color: var(--brand); }
 .metadata-panel, .body-panel { min-width: 0; margin: 0; padding: 1.4rem; border: 1px solid var(--border); border-radius: 1rem; background: var(--surface); box-shadow: var(--shadow-sm); }
 .panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1.15rem; }
 .panel-heading h2 { margin: 0; color: var(--text-primary); font-size: 1rem; font-weight: 750; }
 .panel-heading p { margin: 0.3rem 0 0; color: var(--text-muted); font-size: 0.76rem; line-height: 1.6; }
 .status-badge { flex: none; padding: 0.3rem 0.65rem; border-radius: 999px; background: var(--brand-soft); color: var(--brand-strong); font-size: 0.72rem; font-weight: 700; }
 .article-location { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.35rem; margin: 0 0 1.2rem; padding: 0.65rem 0.8rem; border-radius: 0.6rem; background: var(--surface-subtle); color: var(--text-secondary); font-size: 0.75rem; }
 .article-location span { min-width: 0; overflow-wrap: anywhere; }
 .article-location small { margin-left: auto; color: var(--text-muted); }
 .fields { display: grid; min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 1rem 1.25rem; }
 .identity-fields { margin-bottom: 1.2rem; padding-bottom: 1.2rem; border-bottom: 1px solid var(--border); }
 .field { display: grid; min-width: 0; align-content: start; gap: 0.45rem; }
 .wide { grid-column: 1 / -1; }
 .field > label { color: var(--text-secondary); font-size: 0.78rem; font-weight: 700; }
 .required { margin-left: 0.3rem; color: var(--brand); }
 .field input:not([type="checkbox"]):not([type="file"]), .field textarea { width: 100%; min-width: 0; max-width: 100%; min-height: 2.65rem; box-sizing: border-box; padding: 0.65rem 0.8rem; border: 1px solid var(--border); border-radius: 0.6rem; background: var(--surface); color: var(--text-primary); font: inherit; }
 .field textarea { resize: vertical; line-height: 1.65; }
 .field input.title-input { font-size: 1.05rem; font-weight: 650; }
 .field input:focus, .field textarea:focus { border-color: var(--brand); outline: 3px solid var(--brand-soft); outline-offset: 0; }
 .field input:disabled, .field textarea:disabled { background: var(--surface-subtle); color: var(--text-muted); }
 .field-hint { margin: 0; color: var(--text-muted); font-size: 0.7rem; line-height: 1.6; }
 .cover-control { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.65rem; }
 .upload-button { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: 2.65rem; padding: 0.65rem 0.9rem; border: 1px solid var(--border); border-radius: 0.6rem; background: var(--surface-subtle); color: var(--brand-strong); font-size: 0.78rem; font-weight: 700; white-space: nowrap; cursor: pointer; }
 .upload-button:focus-within { outline: 2px solid var(--brand); outline-offset: 2px; }
 .toggle-fields { display: flex; flex-wrap: wrap; gap: 0.65rem 1.5rem; margin-top: 1.1rem; }
 .toggle-fields .field { display: block; }
 .field label.toggle { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 2rem; cursor: pointer; }
 .toggle input { flex: none; width: 1rem; height: 1rem; margin: 0; padding: 0; accent-color: var(--brand); }
 .advanced-settings { margin-top: 1.1rem; padding-top: 1rem; border-top: 1px solid var(--border); }
 .advanced-settings summary { color: var(--text-secondary); font-size: 0.8rem; font-weight: 650; cursor: pointer; }
 .advanced-settings summary span { margin-left: 0.5rem; color: var(--text-muted); font-size: 0.72rem; font-weight: 400; }
 .advanced-settings[open] .fields { margin-top: 1.1rem; }
 .body-panel { display: grid; gap: 0.9rem; }
 .body-panel .panel-heading { align-items: center; margin-bottom: 0; }
 .body-panel :global(.editor-toolbar) { min-width: 0; max-width: 100%; }
 .editor-workspace { min-width: 0; }
 .body-panel :global(.editor-host .ProseMirror) { min-height: 480px; }
 .actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; padding: 0.9rem 1.1rem; border: 1px solid var(--border); border-radius: 0.85rem; background: var(--surface); box-shadow: var(--shadow-sm); }
 .actions p { margin: 0; color: var(--text-muted); font-size: 0.72rem; }
 .action-buttons { display: flex; flex-wrap: wrap; gap: 0.5rem; }
 .action-button { display: inline-flex; align-items: center; justify-content: center; min-height: 2.5rem; padding: 0.6rem 0.9rem; border: 1px solid var(--border); border-radius: 0.6rem; font: inherit; font-size: 0.78rem; font-weight: 700; line-height: 1.4; cursor: pointer; }
 .secondary { background: var(--surface); color: var(--text-secondary); }
 .primary { border-color: var(--brand); background: var(--brand); color: white; }
 .danger { border-color: #fecaca; background: #fff7f7; color: #b91c1c; }
 .action-button:hover:not(:disabled) { filter: brightness(0.96); }
 .action-button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
 .action-button:disabled { opacity: 0.5; cursor: not-allowed; }
 .mode-switch { flex: none; }
 .notice, .pending-notice { min-width: 0; margin: 0; padding: 0.9rem 1rem; border: 1px solid var(--border); border-radius: 0.7rem; background: var(--brand-soft); color: var(--text-secondary); line-height: 1.7; overflow-wrap: anywhere; }
 .pending-notice { background: var(--warning-soft); }
 .pending-notice p { margin: 0 0 0.65rem; }
 .visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
 @media (max-width: 960px) {
  .actions { align-items: flex-start; flex-direction: column; }
  .action-buttons { width: 100%; }
 }
 @media (max-width: 600px) {
  .configured-editor { gap: 1rem; }
  .metadata-panel, .body-panel { padding: 1rem; border-radius: 0.8rem; }
  .fields { grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  .cover-control { grid-template-columns: minmax(0, 1fr); }
  .upload-button { justify-self: start; }
  .article-location small { flex-basis: 100%; margin-left: 0; }
  .body-panel .panel-heading { align-items: flex-start; flex-direction: column; gap: 0.75rem; }
  .mode-switch { min-height: 2.75rem; }
  .body-panel :global(.editor-host .ProseMirror) { min-height: 420px; }
  .actions { padding: 0.75rem; }
  .action-buttons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .action-button { min-height: 2.75rem; padding-inline: 0.65rem; }
  .advanced-settings summary span { display: block; margin: 0.35rem 0 0 1rem; }
 }
</style>
