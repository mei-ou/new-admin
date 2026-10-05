<script lang="ts">
import { onMount } from "svelte";
import { createSpecialBlock, SPECIAL_BLOCK_LABELS, type SpecialBlockFields } from "./special-block-state";

interface Props {
	fields: SpecialBlockFields;
	editing: boolean;
	onsave: (source: string) => void;
	onclose: () => void;
}
let { fields, editing, onsave, onclose }: Props = $props();
function initialFields() { return { ...fields }; }
let form = $state(initialFields());
let error = $state("");
let dialog: HTMLDialogElement;
onMount(() => {
	const previousFocus = document.activeElement;
	dialog.showModal();
	return () => { if (previousFocus instanceof HTMLElement) previousFocus.focus(); };
});
function save() {
	try { onsave(createSpecialBlock(form)); }
	catch (failure) { error = failure instanceof Error ? failure.message : "特殊块保存失败。"; }
}
</script>

<dialog bind:this={dialog} aria-labelledby="special-title" oncancel={(event) => { event.preventDefault(); onclose(); }}>
  <h2 id="special-title">{editing ? "编辑特殊块" : "插入特殊块"}</h2>
  <p>填写内容后自动生成格式。后台只显示安全占位卡片；发布效果由博客决定。</p>
  <form onsubmit={(event) => { event.preventDefault(); save(); }}>
   <label for="special-kind">特殊块类型</label>
   <select id="special-kind" bind:value={form.kind} disabled={editing}>
    {#each Object.entries(SPECIAL_BLOCK_LABELS) as [kind, label]}<option value={kind}>{label}</option>{/each}
   </select>
   {#if form.kind === "callout"}
    <label for="special-callout-type">提示类型</label>
    <select id="special-callout-type" bind:value={form.calloutType}><option value="NOTE">说明</option><option value="TIP">技巧</option><option value="IMPORTANT">重要</option><option value="WARNING">警告</option><option value="CAUTION">注意</option></select>
   {/if}
   {#if form.kind === "callout" || form.kind === "details"}
    <label for="special-block-title">标题</label><input id="special-block-title" bind:value={form.title} />
   {/if}
   {#if form.kind === "details"}<label class="toggle"><input type="checkbox" bind:checked={form.open} />默认展开</label>{/if}
   {#if form.kind === "video"}
    <label for="special-provider">视频平台</label><select id="special-provider" bind:value={form.provider}><option value="youtube">YouTube</option><option value="bilibili">B 站</option></select>
    <label for="special-video-id">视频号</label><input id="special-video-id" bind:value={form.videoId} placeholder={form.provider === "youtube" ? "11 位视频 ID" : "BV 开头的视频号"} />
   {:else}
    <label for="special-body">{form.kind.startsWith("math") ? "公式（LaTeX）" : form.kind === "mermaid" ? "图表描述（Mermaid）" : "内容"}</label>
    <textarea id="special-body" rows="8" bind:value={form.body}></textarea>
    {#if form.kind.startsWith("math") || form.kind === "mermaid"}<p>公式和图表需要对应语法；不需要自己填写外层分隔符。</p>{/if}
   {/if}
   {#if error}<p class="error" role="alert">{error}</p>{/if}
   <div class="actions"><button type="button" onclick={onclose}>取消</button><button type="submit">{editing ? "保存修改" : "插入正文"}</button></div>
  </form>
</dialog>

<style>
 dialog::backdrop { background: #0006; }
 dialog { width: min(calc(100% - 2rem), 36rem); max-height: calc(100dvh - 2rem); overflow: auto; box-sizing: border-box; padding: 1.5rem; border: 0; border-radius: 1rem; background: var(--surface, white); color: var(--text-primary); box-shadow: var(--shadow-sm); }
 h2 { margin: 0 0 0.75rem; }
 p { color: var(--text-secondary); font-size: 0.85rem; line-height: 1.6; }
 form { display: grid; gap: 0.6rem; }
 label { font-weight: 650; }
 input, textarea, select { box-sizing: border-box; width: 100%; padding: 0.65rem; border: 1px solid var(--border, #ddd); border-radius: 0.5rem; font: inherit; background: var(--surface, white); color: var(--text-primary); }
 textarea { resize: vertical; }
 .toggle { display: flex; align-items: center; gap: 0.5rem; }
 .toggle input { width: auto; }
 .actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem; }
 button { padding: 0.6rem 1rem; border: 1px solid var(--border, #ddd); border-radius: 0.5rem; background: var(--surface, white); color: var(--text-primary); font: inherit; cursor: pointer; }
 button[type="submit"] { background: var(--brand, #2563eb); color: white; }
 .error { color: #b91c1c; }
</style>
