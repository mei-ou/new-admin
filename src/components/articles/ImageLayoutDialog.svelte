<script lang="ts">
import { onMount } from "svelte";
import type { ImageLayout } from "../../../integrations/newfirefly/image-layout.mjs";
import { createImageLayoutSource } from "./image-layout-state";
import { uploadImageBedImage } from "./imagebed-client";

interface Props { fields: ImageLayout; editing: boolean; canUpload: boolean; onsave: (source: string) => void; onclose: () => void; }
let { fields, editing, canUpload, onsave, onclose }: Props = $props();
function initialFields() { return { ...fields, images: fields.images.map(image => ({ ...image })) }; }
let draft = $state(initialFields());
let dialog = $state<HTMLDialogElement>();
let error = $state("");
let uploading = $state(false);
let progress = $state("");
const controller = new AbortController();
onMount(() => {
	const previous = document.activeElement;
	dialog?.showModal();
	return () => { controller.abort(); if (previous instanceof HTMLElement) previous.focus(); };
});
function save() {
	try { onsave(createImageLayoutSource(draft)); } catch (failure) { error = failure instanceof Error ? failure.message : "图片设置无效。"; }
}
function move(index: number, delta: number) {
	const next = [...draft.images];
	const destination = index + delta;
	if (destination < 0 || destination >= next.length) return;
	[next[index], next[destination]] = [next[destination]!, next[index]!];
	draft.images = next;
}
function addImage() {
	if (draft.images.length >= 20) { error = "图片组最多支持 20 张。"; return; }
	if (draft.layout === "single" && draft.images.length) draft.layout = "adaptive";
	draft.images.push({ src: "", alt: "", title: "" });
}
async function upload(event: Event, replaceIndex?: number) {
	const input = event.currentTarget as HTMLInputElement;
	const files = Array.from(input.files ?? []);
	input.value = "";
	if (!canUpload || uploading || !files.length) return;
	error = "";
	const existing = draft.images.filter(image => image.src.trim());
	if (replaceIndex === undefined && existing.length + files.length > 20) { error = "图片组最多支持 20 张。"; return; }
	if (replaceIndex !== undefined && files.length !== 1) { error = "换图时请选择一张图片。"; return; }
	if (files.some(file => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024)) { error = "图片仅支持 JPEG、PNG、WebP，每张不超过 5 MiB。"; return; }
	uploading = true;
	try {
		if (replaceIndex === undefined) draft.images = existing;
		for (let index = 0; index < files.length; index += 1) {
			const file = files[index]!;
			progress = `正在上传 ${index + 1}/${files.length}…`;
			const src = await uploadImageBedImage(file, controller.signal);
			if (controller.signal.aborted) return;
			if (replaceIndex !== undefined) draft.images[replaceIndex]!.src = src;
			else { draft.images.push({ src, alt: file.name, title: "" }); if (draft.images.length > 1 && draft.layout === "single") draft.layout = "adaptive"; }
		}
	} catch (failure) { if (!controller.signal.aborted) error = failure instanceof Error ? failure.message : "上传失败，已成功上传的图片仍保留，可重试其余图片。"; }
	finally { uploading = false; progress = ""; }
}
</script>

<dialog bind:this={dialog} aria-labelledby="image-layout-title" oncancel={(event) => { event.preventDefault(); onclose(); }}>
 <h2 id="image-layout-title">{editing ? "编辑图片／换图" : "插入图片／图片组"}</h2>
 <form onsubmit={(event) => { event.preventDefault(); save(); }}>
  <fieldset disabled={uploading}>
   <div class="settings">
    <label>排版方式<select aria-label="图片排版方式" bind:value={draft.layout}><option value="single">单张图片</option><option value="grid">多图网格</option><option value="swipe">横向滑动</option><option value="adaptive">电脑横排，手机滑动</option></select></label>
    {#if draft.layout === "single"}<label>显示宽度<select aria-label="图片显示宽度" bind:value={draft.width}><option value={25}>小（25%）</option><option value={50}>中（50%）</option><option value={75}>大（75%）</option><option value={100}>铺满正文（100%）</option></select></label>
    <label>对齐方式<select aria-label="图片对齐方式" bind:value={draft.align}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
    {:else}<label>电脑每行图片数<select aria-label="每行图片数" bind:value={draft.columns}><option value={2}>2 张</option><option value={3}>3 张</option><option value={4}>4 张</option></select></label>{/if}
   </div>
   <p>图片保持原比例，不修改图床原文件。手机滑动模式不会把所有图片挤在一行。</p>
   {#each draft.images as image, index}
    <div class="image-row">
     <strong>图片 {index + 1}</strong>
     {#if image.src.startsWith("https://") || /^\/(?!\/)/.test(image.src)}<img class="preview" src={image.src} alt={image.alt} referrerpolicy="no-referrer" />{/if}
     <label>图片链接<input aria-label={`图片 ${index + 1} 链接`} type="text" bind:value={image.src} placeholder="https://… 图床图片直链" required maxlength="2048" /></label>
     <label>图片说明<input aria-label={`图片 ${index + 1} 说明`} bind:value={image.alt} maxlength="500" /></label>
     <label>悬停标题<input aria-label={`图片 ${index + 1} 标题`} bind:value={image.title} maxlength="500" /></label>
     <div class="row-actions">
      {#if canUpload}<label class="upload">上传替换<input aria-label={`上传替换图片 ${index + 1}`} type="file" accept="image/png,image/jpeg,image/webp" onchange={(event) => void upload(event, index)} /></label>{/if}
      <button type="button" disabled={index === 0} onclick={() => move(index, -1)} aria-label={`图片 ${index + 1} 上移`}>上移</button>
      <button type="button" disabled={index === draft.images.length - 1} onclick={() => move(index, 1)} aria-label={`图片 ${index + 1} 下移`}>下移</button>
      <button type="button" onclick={() => draft.images.splice(index, 1)} aria-label={`移除图片 ${index + 1}`}>移除</button>
     </div>
    </div>
   {/each}
   <div class="row-actions"><button type="button" onclick={addImage}>添加图片链接</button>{#if canUpload}<label class="upload">批量上传图片<input aria-label="批量上传图片" type="file" multiple accept="image/png,image/jpeg,image/webp" onchange={(event) => void upload(event)} /></label>{/if}</div>
  </fieldset>
  {#if progress}<p role="status">{progress}</p>{/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <p>换图会保留说明和排版设置。移除或取消不会删除图床文件；保存设置后还需保存或发布文章。</p>
  {#if !editing}<p>可视化模式新增到正文末尾；源码模式插入到光标位置。已有图片通过“编辑／换图”修改时保留原位置。</p>{/if}
  <div class="actions"><button type="button" onclick={onclose}>取消</button><button type="submit" disabled={uploading}>{editing ? "保存图片设置" : "插入正文"}</button></div>
 </form>
</dialog>

<style>
 dialog { position: fixed; inset: 0; margin: auto; width: min(calc(100% - 2rem), 44rem); max-width: calc(100% - 2rem); max-height: calc(100dvh - 2rem); padding: 1.3rem; border: 1px solid var(--border); border-radius: 1rem; color: var(--text-primary); background: var(--surface); overflow: auto; overscroll-behavior: contain; }
 dialog::backdrop { background: #0006; }
 h2 { margin: 0 0 1rem; }
 form, fieldset, .image-row { display: grid; gap: 0.75rem; min-width: 0; }
 fieldset { border: 0; padding: 0; margin: 0; }
 .settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.75rem; }
 label { display: grid; gap: 0.35rem; min-width: 0; }
 input, select { width: 100%; min-width: 0; box-sizing: border-box; min-height: 2.7rem; padding: 0.6rem; border: 1px solid var(--border); border-radius: 0.5rem; color: inherit; background: var(--surface); font: inherit; }
 input[type="file"] { font-size: 0.75rem; }
 .image-row { padding: 0.8rem; border: 1px solid var(--border); border-radius: 0.75rem; }
 .preview { max-width: 100%; width: auto; max-height: 9rem; object-fit: contain; justify-self: start; }
 p { margin: 0; font-size: 0.8rem; line-height: 1.6; color: var(--text-secondary); overflow-wrap: anywhere; }
 .row-actions, .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
 .actions { justify-content: flex-end; }
 button { min-height: 2.7rem; padding: 0.6rem 0.9rem; border: 1px solid var(--border); border-radius: 0.5rem; font: inherit; color: inherit; background: var(--surface); cursor: pointer; }
 button:disabled { opacity: 0.5; cursor: default; }
 .upload { flex: 1; min-width: 0; font-size: 0.8rem; }
 .error { color: var(--danger, #b91c1c); }
 @media (max-width: 600px) { dialog { padding: 1rem; } .actions button { flex: 1; } }
</style>
