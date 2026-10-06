<script lang="ts">
import { onMount } from "svelte";
import type { CodeMirrorEditorHandle, CodeMirrorRuntime } from "./codemirror-runtime";

interface Props {
	value?: string;
	disabled?: boolean;
	onchange?: (value: string) => void;
	onready?: (handle: CodeMirrorEditorHandle) => void;
	ondispose?: () => void;
}

let { value = "", disabled = false, onchange, onready, ondispose }: Props = $props();
let host: HTMLDivElement;
let enhancedHost: HTMLDivElement;
let fallback = $state<HTMLTextAreaElement>();
let runtime = $state<CodeMirrorRuntime>();
let loading = $state(true);
let loadError = $state("");

onMount(() => {
	let disposed = false;
	const nativeInput = fallback;
	if (!nativeInput) return;
	function replaceFallback(text: string, from: number, to: number, selectionFrom = text.length, selectionTo = selectionFrom) {
		if (disabled) return;
		const safeFrom = Math.max(0, Math.min(from, nativeInput.value.length));
		const safeTo = Math.max(safeFrom, Math.min(to, nativeInput.value.length));
		nativeInput.setRangeText(text, safeFrom, safeTo, "end");
		nativeInput.setSelectionRange(safeFrom + selectionFrom, safeFrom + selectionTo);
		value = nativeInput.value;
		onchange?.(value);
		nativeInput.focus();
	}
	onready?.({
		focus: () => nativeInput.focus(),
		getSelection: () => ({ from: nativeInput.selectionStart, to: nativeInput.selectionEnd, text: nativeInput.value.slice(nativeInput.selectionStart, nativeInput.selectionEnd) }),
		replaceRange: replaceFallback,
		replaceSelection: (text, selectionFrom, selectionTo) => replaceFallback(text, nativeInput.selectionStart, nativeInput.selectionEnd, selectionFrom, selectionTo),
		undo: () => nativeInput.focus(),
		redo: () => nativeInput.focus(),
	});

	async function mountEditor(): Promise<void> {
		try {
			// 仅在浏览器真正挂载编辑器时下载 CodeMirror，避免阻塞页面外壳和其他后台页面。
			const { createCodeMirrorRuntime } = await import("./codemirror-runtime");
			if (disposed) return;
			const hadFocus = document.activeElement === nativeInput;
			const selection = { from: nativeInput.selectionStart, to: nativeInput.selectionEnd };
			runtime = createCodeMirrorRuntime({ parent: enhancedHost, value, disabled, onchange });
			const currentRuntime = runtime;
			if (hadFocus) { currentRuntime.replaceRange("", selection.from, selection.from, 0, selection.to - selection.from); currentRuntime.focus(); }
			onready?.({
				focus: () => currentRuntime.focus(),
				getSelection: () => currentRuntime.getSelection(),
				replaceRange: (text, from, to, selectionFrom, selectionTo) =>
					currentRuntime.replaceRange(text, from, to, selectionFrom, selectionTo),
				replaceSelection: (text, selectionFrom, selectionTo) =>
					currentRuntime.replaceSelection(text, selectionFrom, selectionTo),
				undo: () => currentRuntime.undo(),
				redo: () => currentRuntime.redo(),
			});
		} catch {
			loadError = "增强工具暂未加载，仍可在下方编辑和保存源码。基础模式撤销请用键盘快捷键。";
		} finally {
			loading = false;
		}
	}

	void mountEditor();
	return () => {
		disposed = true;
		runtime?.destroy();
		runtime = undefined;
		ondispose?.();
	};
});

$effect(() => {
	runtime?.setValue(value);
});

$effect(() => {
	runtime?.setDisabled(disabled);
});
</script>

<div class="editor-host" bind:this={host}>
	{#if loading}<p role="status">源码已可编辑，正在加载语法高亮等增强工具…</p>{/if}
	{#if loadError}<p class="load-error" role="alert">{loadError}</p>{/if}
	{#if !runtime}<textarea aria-label="Markdown 源码编辑器" bind:this={fallback} {value} {disabled} spellcheck="false" oninput={(event) => { value = event.currentTarget.value; onchange?.(value); }}></textarea>{/if}
	<div bind:this={enhancedHost}></div>
</div>

<style>
	.editor-host {
		overflow: hidden;
		min-height: 520px;
		border: 1px solid var(--border);
		border-radius: 0.7rem;
		background: white;
	}

	textarea { display: block; width: 100%; min-height: 480px; padding: 1rem; border: 0; resize: vertical; font: 0.9rem/1.7 ui-monospace, monospace; color: var(--text-primary); background: var(--surface); }

	.editor-host p {
		margin: 0;
		padding: 0.65rem 1rem;
		color: var(--text-muted);
		font-size: 0.82rem;
	}

	.editor-host .load-error {
		color: #b91c1c;
	}

	.editor-host:focus-within {
		border-color: var(--brand);
		box-shadow: 0 0 0 3px var(--brand-soft);
	}

	@media (max-width: 680px) {
		.editor-host { min-height: 420px; border-radius: 0 0 0.75rem 0.75rem; }
		.editor-host :global(.cm-content) { min-height: 420px; padding: 12px 0; font-size: 12px; }
	}
</style>
