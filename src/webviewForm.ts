import * as vscode from "vscode";
import {
	BODY_MAX_LINE_LENGTH,
	BODY_MAX_LINES,
	CATEGORY_MAX_LENGTH,
	MAX_RECORD_SIZE_BYTES,
	TITLE_MAX_LENGTH,
	TaskDuration,
	TYPE_MAX_LENGTH
} from "./api";

export interface CheatFormResult {
	title: string;
	typeName: string;
	private: boolean;
	body: string;
}

export interface TaskFormResult {
	title: string;
	category: string;
	duration: TaskDuration;
	text: string;
}

function nonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let text = "";
	for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
	return text;
}

// Embeds arbitrary user text (e.g. a code selection) as a JS string literal inside a <script>
// block. JSON.stringify alone isn't safe here: the HTML parser looks for a literal "</script"
// regardless of JS string-quoting, so text containing that sequence would truncate the script.
function jsStringLiteral(value: string): string {
	return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

const SHARED_STYLE = `
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 18px 22px 22px; font-size: 13px; }
	.field { margin-bottom: 14px; }
	label { display: block; font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
	input[type=text], textarea, select {
		width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 6px 8px; font-family: inherit; font-size: 13px;
	}
	textarea { font-family: var(--vscode-editor-font-family, monospace); resize: vertical; }
	input:focus, textarea:focus, select:focus, .toggle-btn:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
	.uppercase-field { text-transform: uppercase; }
	.editor { position: relative; }
	.editor textarea { line-height: 20px; padding-left: 42px; }
	.line-numbers {
		position: absolute; top: 0; left: 0; bottom: 0; width: 36px; box-sizing: border-box;
		overflow: hidden; padding: 6px 6px 6px 0; text-align: right; white-space: pre;
		font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; line-height: 20px;
		color: var(--vscode-editorLineNumber-foreground, var(--vscode-descriptionForeground));
		user-select: none; pointer-events: none;
	}
	.row { display: flex; gap: 14px; }
	.row > .field { flex: 1; }
	.hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
	.hint.error { color: var(--vscode-errorForeground); }
	.toggle-btn {
		width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 6px 8px; font-family: inherit;
		font-size: 13px; text-transform: uppercase; text-align: left; cursor: pointer;
	}
	.toggle-btn:hover { border-color: var(--vscode-focusBorder); }
	.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
	button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; padding: 6px 16px; font-size: 13px; cursor: pointer; }
	button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
	button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
	button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
	button.secondary { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); }
	button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground)); }
`;

// Shared by both forms: the content field is identical between them (same id, same gutter
// markup), only the surrounding fields differ.
const BODY_FIELD_HTML = `
<div class="field">
	<label for="body">Content</label>
	<div class="editor">
		<div class="line-numbers" id="bodyLineNumbers"></div>
		<textarea id="body" rows="12"></textarea>
	</div>
	<div class="hint" id="bodyHint"></div>
</div>`;

// Shared by both forms: renders 1..N into the gutter next to #body and keeps it in sync as the
// user types or scrolls. An IIFE so its locals don't collide with each form's own script scope.
const LINE_NUMBERS_SCRIPT = `
	(function() {
		const bodyEl = document.getElementById("body");
		const lineNumbersEl = document.getElementById("bodyLineNumbers");
		function updateLineNumbers() {
			const count = bodyEl.value.split(/\\r\\n|\\r|\\n/).length;
			let numbers = "";
			for (let i = 1; i <= count; i++) numbers += i + "\\n";
			lineNumbersEl.textContent = numbers;
		}
		bodyEl.addEventListener("input", updateLineNumbers);
		bodyEl.addEventListener("scroll", () => { lineNumbersEl.scrollTop = bodyEl.scrollTop; });
		updateLineNumbers();
	})();
`;

function panelHtml(nonceValue: string, title: string, fieldsHtml: string, saveLabel: string, scriptBody: string): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonceValue}';">
<title>${title}</title>
<style>${SHARED_STYLE}</style>
</head>
<body>
${fieldsHtml}
<div class="actions">
	<button class="secondary" id="cancelBtn">Cancel</button>
	<button class="primary" id="saveBtn" disabled>${saveLabel}</button>
</div>
<script nonce="${nonceValue}">
	const vscode = acquireVsCodeApi();
	document.getElementById("cancelBtn").addEventListener("click", () => vscode.postMessage({ command: "cancel" }));
	${scriptBody}
</script>
</body>
</html>`;
}

// Shared by both forms: creates the panel, renders its HTML, and wires up the submit/cancel
// message protocol they both speak. Only the fields/validation script (form-specific, since the
// two forms have different fields) and the submit-message shape (typed per form) vary by caller.
function openFormPanel<T>(
	viewType: string,
	title: string,
	fieldsHtml: string,
	saveLabel: string,
	scriptBody: string,
	parseSubmit: (message: Record<string, unknown>) => T
): Promise<T | undefined> {
	return new Promise(resolve => {
		const panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, { enableScripts: true });
		panel.webview.html = panelHtml(nonce(), title, fieldsHtml, saveLabel, scriptBody);

		panel.webview.onDidReceiveMessage((message: { command: string } & Record<string, unknown>) => {
			if (message.command === "submit") {
				resolve(parseSubmit(message));
				panel.dispose();
			} else if (message.command === "cancel") {
				resolve(undefined);
				panel.dispose();
			}
		});
		panel.onDidDispose(() => resolve(undefined));
	});
}

export function showCreateCheatForm(initialBody: string): Promise<CheatFormResult | undefined> {
	const fields = `
<div class="field">
	<label for="title">Title</label>
	<input type="text" id="title" class="uppercase-field" maxlength="${TITLE_MAX_LENGTH}" autofocus />
	<div class="hint" id="titleHint"></div>
</div>
<div class="row">
	<div class="field">
		<label for="typeName">Type</label>
		<input type="text" id="typeName" class="uppercase-field" maxlength="${TYPE_MAX_LENGTH}" placeholder="e.g. javascript, git, regex" />
		<div class="hint" id="typeHint"></div>
	</div>
	<div class="field">
		<label for="visibilityToggle">Visibility</label>
		<button type="button" id="visibilityToggle" class="toggle-btn"></button>
	</div>
</div>${BODY_FIELD_HTML}`;

	const script = `
		const TITLE_MAX = ${TITLE_MAX_LENGTH};
		const TYPE_MAX = ${TYPE_MAX_LENGTH};
		const BODY_MAX_LINES = ${BODY_MAX_LINES};
		const BODY_MAX_LINE_LENGTH = ${BODY_MAX_LINE_LENGTH};
		const MAX_RECORD_BYTES = ${MAX_RECORD_SIZE_BYTES};

		const titleEl = document.getElementById("title");
		const typeEl = document.getElementById("typeName");
		const bodyEl = document.getElementById("body");
		const saveBtn = document.getElementById("saveBtn");

		bodyEl.value = ${jsStringLiteral(initialBody)};

		// Defaults to private, unlike the site's own new-cheat form (which defaults to public) —
		// a private-by-default snippet saved from an editor is less likely to be something meant
		// to publish immediately.
		let isPrivate = true;
		const visibilityBtn = document.getElementById("visibilityToggle");
		function renderVisibility() {
			visibilityBtn.textContent = isPrivate ? "Private" : "Public";
			visibilityBtn.title = isPrivate ? "Click to make public" : "Click to make private";
		}
		renderVisibility();
		visibilityBtn.addEventListener("click", () => {
			isPrivate = !isPrivate;
			renderVisibility();
			validate();
		});

		function validate() {
			const title = titleEl.value.trim();
			const typeName = typeEl.value.trim();
			const lines = bodyEl.value.split(/\\r\\n|\\r|\\n/);
			const longLine = lines.find(l => l.length > BODY_MAX_LINE_LENGTH);
			const record = { title, typeName, body: { text: bodyEl.value }, private: isPrivate };
			const size = new TextEncoder().encode(JSON.stringify(record)).length;

			document.getElementById("titleHint").textContent = title.length + "/" + TITLE_MAX + " characters";
			document.getElementById("typeHint").textContent = typeName.length + "/" + TYPE_MAX + " characters";
			const bodyHint = document.getElementById("bodyHint");
			bodyHint.textContent = lines.length + "/" + BODY_MAX_LINES + " lines, " + (size / 1024).toFixed(1) + "KB/" + (MAX_RECORD_BYTES / 1024) + "KB";
			const bodyInvalid = lines.length > BODY_MAX_LINES || longLine !== undefined || size > MAX_RECORD_BYTES;
			bodyHint.classList.toggle("error", bodyInvalid);

			const ok = title && title.length <= TITLE_MAX && typeName && typeName.length <= TYPE_MAX
				&& bodyEl.value.trim() && !bodyInvalid;
			saveBtn.disabled = !ok;
			return ok ? record : null;
		}

		[titleEl, typeEl, bodyEl].forEach(el => el.addEventListener("input", validate));
		validate();

		saveBtn.addEventListener("click", () => {
			const record = validate();
			if (record) vscode.postMessage({ command: "submit", ...record });
		});

		${LINE_NUMBERS_SCRIPT}
	`;

	return openFormPanel("cheatsCreateCheat", "New Cheat", fields, "Save cheat", script, message => ({
		title: message.title as string,
		typeName: message.typeName as string,
		private: !!message.private,
		body: (message.body as { text: string }).text
	}));
}

export function showCreateTaskForm(initialBody: string): Promise<TaskFormResult | undefined> {
	const fields = `
<div class="field">
	<label for="title">Title</label>
	<input type="text" id="title" class="uppercase-field" maxlength="${TITLE_MAX_LENGTH}" autofocus />
	<div class="hint" id="titleHint"></div>
</div>
<div class="row">
	<div class="field">
		<label for="category">Category</label>
		<input type="text" id="category" class="uppercase-field" maxlength="${CATEGORY_MAX_LENGTH}" placeholder="e.g. AI, or a project name (optional)" />
		<div class="hint" id="categoryHint"></div>
	</div>
	<div class="field">
		<label for="durationToggle">Expiry</label>
		<button type="button" id="durationToggle" class="toggle-btn" title="Click to change expiry"></button>
	</div>
</div>${BODY_FIELD_HTML}`;

	const script = `
		const TITLE_MAX = ${TITLE_MAX_LENGTH};
		const CATEGORY_MAX = ${CATEGORY_MAX_LENGTH};
		const BODY_MAX_LINES = ${BODY_MAX_LINES};
		const BODY_MAX_LINE_LENGTH = ${BODY_MAX_LINE_LENGTH};
		const MAX_RECORD_BYTES = ${MAX_RECORD_SIZE_BYTES};

		const titleEl = document.getElementById("title");
		const categoryEl = document.getElementById("category");
		const bodyEl = document.getElementById("body");
		const saveBtn = document.getElementById("saveBtn");

		bodyEl.value = ${jsStringLiteral(initialBody)};

		// Same cycling-label interaction as the site's own task editor (renderTaskEditor in
		// public/js/tasks.js): click steps through the fixed set of durations in order.
		const DURATION_KEYS = ["permanent", "1h", "1d", "1w"];
		const DURATION_LABELS = { permanent: "Permanent", "1h": "1 hour", "1d": "1 day", "1w": "1 week" };
		let duration = "permanent";
		const durationBtn = document.getElementById("durationToggle");
		function renderDuration() {
			durationBtn.textContent = DURATION_LABELS[duration];
		}
		renderDuration();
		durationBtn.addEventListener("click", () => {
			duration = DURATION_KEYS[(DURATION_KEYS.indexOf(duration) + 1) % DURATION_KEYS.length];
			renderDuration();
			validate();
		});

		function validate() {
			const title = titleEl.value.trim();
			const category = categoryEl.value.trim();
			const lines = bodyEl.value.split(/\\r\\n|\\r|\\n/);
			const longLine = lines.find(l => l.length > BODY_MAX_LINE_LENGTH);
			const record = { title, category, text: bodyEl.value, duration };
			const size = new TextEncoder().encode(JSON.stringify(record)).length;

			document.getElementById("titleHint").textContent = title.length + "/" + TITLE_MAX + " characters";
			document.getElementById("categoryHint").textContent = category.length + "/" + CATEGORY_MAX + " characters";
			const bodyHint = document.getElementById("bodyHint");
			bodyHint.textContent = lines.length + "/" + BODY_MAX_LINES + " lines, " + (size / 1024).toFixed(1) + "KB/" + (MAX_RECORD_BYTES / 1024) + "KB";
			const bodyInvalid = lines.length > BODY_MAX_LINES || longLine !== undefined || size > MAX_RECORD_BYTES;
			bodyHint.classList.toggle("error", bodyInvalid);

			const ok = title && title.length <= TITLE_MAX && category.length <= CATEGORY_MAX
				&& bodyEl.value.trim() && !bodyInvalid;
			saveBtn.disabled = !ok;
			return ok ? record : null;
		}

		[titleEl, categoryEl, bodyEl].forEach(el => el.addEventListener("input", validate));
		validate();

		saveBtn.addEventListener("click", () => {
			const record = validate();
			if (record) vscode.postMessage({ command: "submit", ...record });
		});

		${LINE_NUMBERS_SCRIPT}
	`;

	return openFormPanel("cheatsCreateTask", "New Task", fields, "Save task", script, message => ({
		title: message.title as string,
		category: message.category as string,
		text: message.text as string,
		duration: message.duration as TaskDuration
	}));
}
