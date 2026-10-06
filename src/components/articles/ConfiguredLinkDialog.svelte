<script lang="ts">
import { onMount } from "svelte";
import type { AdminCapabilitySnapshot } from "../../types/capability";
import { parseArticleLinkTargetsPayload, type ArticleLinkTarget } from "./article-link-targets";
import { buildStyledLink, type LinkStyle } from "./link-style";

interface Props {
	capabilities: AdminCapabilitySnapshot;
	selectedText: string;
	oninsert: (markdown: string, style: LinkStyle) => void;
	onclose: () => void;
}
let { capabilities, selectedText, oninsert, onclose }: Props = $props();
function initialText() { return selectedText; }
let text = $state(initialText());
let style = $state<LinkStyle>("text");
function initialExternal() { return !capabilities.articleLinks; }
let external = $state(initialExternal());
let target = $state("");
let heading = $state("");
let query = $state("");
let items = $state<ArticleLinkTarget[]>([]);
let loading = $state(false);
let truncated = $state(false);
let error = $state("");
let selected = $state<ArticleLinkTarget>();
let dialog: HTMLDialogElement;
let request: AbortController | undefined;
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function loadTargets(search = "") {
	if (!capabilities.articleLinks) return;
	request?.abort();
	request = new AbortController();
	const currentRequest = request;
	const current = ++sequence;
	loading = true;
	const timeout = setTimeout(() => currentRequest.abort(), 15000);
	try {
		const response = await fetch(`/api/articles/link-targets?query=${encodeURIComponent(search.trim())}`, { signal: currentRequest.signal, headers: { Accept: "application/json" } });
		if (!response.ok) throw new Error("文章列表暂时无法加载，可直接填写文章路径。");
		const parsed = parseArticleLinkTargetsPayload(await response.json());
		if (current !== sequence) return;
		items = parsed.items;
		truncated = parsed.truncated;
		error = "";
	} catch (failure) {
		if (current === sequence) error = currentRequest.signal.aborted ? "文章列表加载超时，可直接填写文章路径。" : failure instanceof Error ? failure.message : "文章列表暂时无法加载。";
	} finally { clearTimeout(timeout); if (current === sequence) loading = false; }
}
onMount(() => {
	const previous = document.activeElement;
	dialog.showModal();
	void loadTargets();
	return () => { request?.abort(); sequence += 1; if (timer) clearTimeout(timer); if (previous instanceof HTMLElement) previous.focus(); };
});
function search() { if (timer) clearTimeout(timer); timer = setTimeout(() => void loadTargets(query), 300); }
function choose(article: ArticleLinkTarget) {
	selected = article;
	target = article.storageSlug;
	heading = "";
	if (!text.trim()) text = article.title;
}
function save() {
	try {
		const effectiveTarget = !external && style === "text" && selected && target === selected.storageSlug ? selected.slug : target;
		oninsert(buildStyledLink({ style, text, target: effectiveTarget, heading, external }), style);
	} catch (failure) { error = failure instanceof Error ? failure.message : "链接信息无效。"; }
}
</script>

<dialog bind:this={dialog} aria-labelledby="configured-link-title" oncancel={(event) => { event.preventDefault(); onclose(); }}>
 <h2 id="configured-link-title">插入链接</h2>
 <form onsubmit={(event) => { event.preventDefault(); save(); }}>
  <label for="link-style">链接样式</label><select id="link-style" bind:value={style} onchange={() => { if (style !== "text" && external) { external = false; target = ""; heading = ""; selected = undefined; } }}><option value="text">普通文字链接</option>{#if capabilities.articleLinks}<option value="wiki">Wiki Link（随所在段落显示）</option><option value="card">文章卡片（单独成段）</option>{/if}</select>
  <label for="link-source">链接目标</label><select id="link-source" bind:value={external} onchange={() => { target = ""; heading = ""; selected = undefined; }}>{#if capabilities.articleLinks}<option value={false}>站内文章</option>{/if}{#if capabilities.externalHttpsLinks && style === "text"}<option value={true}>外部网址</option>{/if}</select>
  {#if !external}
   <label for="link-query">搜索文章</label><input id="link-query" bind:value={query} oninput={search} maxlength="100" />
   {#if loading}<p role="status">正在读取文章列表，仍可手动填写路径…</p>{/if}
   <div class="targets">{#each items as article}<button type="button" class:active={selected?.storageSlug === article.storageSlug} onclick={() => choose(article)}>{article.title}<small>{article.storageSlug}</small></button>{/each}</div>
   {#if truncated}<p>列表范围受限，请使用搜索或手动填写完整路径。</p>{/if}
  {/if}
  <label for="link-target">{external ? "网址" : "文章路径（不含 .md）"}</label><input id="link-target" bind:value={target} placeholder={external ? "https://…" : "博客指南/博客使用指南"} required />
  <label for="link-text">显示文字（可选）</label><input id="link-text" bind:value={text} maxlength="500" />
  {#if !external && style !== "card"}<label for="link-heading">标题锚点（可选）</label><input id="link-heading" bind:value={heading} list="link-headings" /><datalist id="link-headings">{#each selected?.headings ?? [] as item}<option value={item.id}>{item.text}</option>{/each}</datalist>{/if}
  <p>{style === "text" ? "生成普通 Markdown 链接，可随博客域名迁移。" : "生成 [[文章路径|显示文字]]。Wiki Link 单独成段时显示卡片，夹在正文中时显示文字链接；需博客前台的 Wiki Link 插件。"}</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions"><button type="button" onclick={onclose}>取消</button><button type="submit">插入链接</button></div>
 </form>
</dialog>

<style>
 dialog { position: fixed; inset: 0; margin: auto; width: min(calc(100% - 2rem), 36rem); max-width: calc(100% - 2rem); max-height: calc(100dvh - 2rem); overflow: auto; overscroll-behavior: contain; padding: 1.5rem; border: 0; border-radius: 1rem; background: var(--surface); color: var(--text-primary); overflow-wrap: anywhere; }
 dialog::backdrop { background: #0006; }
 h2 { margin: 0 0 1rem; }
 form { display: grid; gap: 0.65rem; }
 label { font-weight: 650; }
 input, select { width: 100%; min-width: 0; min-height: 2.65rem; padding: 0.6rem; border: 1px solid var(--border); border-radius: 0.5rem; font: inherit; color: var(--text-primary); background: var(--surface); }
 p, small { color: var(--text-secondary); font-size: 0.8rem; line-height: 1.6; }
 small { display: block; }
 .targets { display: grid; gap: 0.4rem; max-height: 10rem; overflow: auto; }
 button { padding: 0.6rem 0.9rem; border: 1px solid var(--border); border-radius: 0.5rem; font: inherit; background: var(--surface); color: var(--text-primary); cursor: pointer; }
 .targets button { text-align: left; overflow-wrap: anywhere; }
 .active { background: var(--brand-soft); }
 .actions { display: flex; justify-content: flex-end; gap: 0.6rem; }
 button[type="submit"] { background: var(--brand); color: white; }
 .error { color: #b91c1c; }
 @media (max-width: 600px) { dialog { padding: 1rem; } .actions button { flex: 1; min-height: 2.75rem; } }
</style>
