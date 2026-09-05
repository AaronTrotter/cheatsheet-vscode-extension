import * as vscode from "vscode";
import {
	BODY_MAX_LINE_LENGTH,
	BODY_MAX_LINES,
	MAX_RECORD_SIZE_BYTES,
	SECTION_CATEGORIES,
	TaskCategory,
	TaskDuration,
	TaskSection,
	TITLE_MAX_LENGTH,
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
	category: TaskCategory;
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

// Shared by every form: the content field is identical between them (same id, same gutter
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

// Shared by every form: renders 1..N into the gutter next to #body and keeps it in sync as the
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

// A .toggle-btn whose click cycles through a fixed set of values, the interaction the site's own
// editors use for these fields (renderTaskEditor in public/js/tasks.js) rather than a dropdown or
// a text input. Shared by all three of them: a cheat's visibility (a two-value case), and a task's
// category and expiry. `titles` is optional, pass it only when the tooltip should change with the
// value, otherwise the button keeps whatever static title its markup declares.
function cyclingToggleScript(
	stateVar: string,
	buttonId: string,
	keys: readonly string[],
	labels: Record<string, string>,
	titles?: Record<string, string>
): string {
	const render = `render${stateVar[0].toUpperCase()}${stateVar.slice(1)}`;
	return `
		let ${stateVar} = ${JSON.stringify(keys[0])};
		const ${stateVar}Keys = ${JSON.stringify(keys)};
		const ${stateVar}Labels = ${JSON.stringify(labels)};
		const ${stateVar}Btn = document.getElementById(${JSON.stringify(buttonId)});
		function ${render}() {
			${stateVar}Btn.textContent = ${stateVar}Labels[${stateVar}];
			${titles ? `${stateVar}Btn.title = ${JSON.stringify(titles)}[${stateVar}];` : ""}
		}
		${render}();
		${stateVar}Btn.addEventListener("click", () => {
			${stateVar} = ${stateVar}Keys[(${stateVar}Keys.indexOf(${stateVar}) + 1) % ${stateVar}Keys.length];
			${render}();
			validate();
		});
	`;
}

// The one free-text field a form has besides its title. Cheats have one (typeName, a freeform
// taxonomy lookup); the task and Brain forms don't, since their category is a closed enum served
// by a pill and so can never be invalid.
interface TextField {
	/** Element variable, declared in the caller's prelude. */
	elementVar: string;
	/** Variable the trimmed value binds to, for `recordExpr` to reference. */
	valueVar: string;
	hintId: string;
	/** Max-length constant, declared in the caller's prelude. */
	maxVar: string;
	required: boolean;
}

// Shared by every form: the body checks (line count, per-line length, total record size against
// the server's own caps), the character-count hints, and the save-button wiring are identical
// across them. Only the payload being built and the optional second text field differ.
function validationScript(recordExpr: string, textField?: TextField): string {
	const secondField = textField
		? {
			declare: `const ${textField.valueVar} = ${textField.elementVar}.value.trim();`,
			hint: `document.getElementById("${textField.hintId}").textContent = ${textField.valueVar}.length + "/" + ${textField.maxVar} + " characters";`,
			ok: `&& ${textField.required ? `${textField.valueVar} && ` : ""}${textField.valueVar}.length <= ${textField.maxVar}`,
			listener: `${textField.elementVar}, `
		}
		: { declare: "", hint: "", ok: "", listener: "" };

	return `
		function validate() {
			const title = titleEl.value.trim();
			${secondField.declare}
			const lines = bodyEl.value.split(/\\r\\n|\\r|\\n/);
			const longLine = lines.find(l => l.length > BODY_MAX_LINE_LENGTH);
			const record = ${recordExpr};
			const size = new TextEncoder().encode(JSON.stringify(record)).length;

			document.getElementById("titleHint").textContent = title.length + "/" + TITLE_MAX + " characters";
			${secondField.hint}
			const bodyHint = document.getElementById("bodyHint");
			bodyHint.textContent = lines.length + "/" + BODY_MAX_LINES + " lines, " + (size / 1024).toFixed(1) + "KB/" + (MAX_RECORD_BYTES / 1024) + "KB";
			const bodyInvalid = lines.length > BODY_MAX_LINES || longLine !== undefined || size > MAX_RECORD_BYTES;
			bodyHint.classList.toggle("error", bodyInvalid);

			const ok = title && title.length <= TITLE_MAX ${secondField.ok}
				&& bodyEl.value.trim() && !bodyInvalid;
			saveBtn.disabled = !ok;
			return ok ? record : null;
		}

		[titleEl, ${secondField.listener}bodyEl].forEach(el => el.addEventListener("input", validate));
		validate();

		saveBtn.addEventListener("click", () => {
			const record = validate();
			if (record) vscode.postMessage({ command: "submit", ...record });
		});
	`;
}

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

// Shared by every form: creates the panel, renders its HTML, and wires up the submit/cancel
// message protocol they all speak. Only the fields/validation script (form-specific, since the
// forms have different fields) and the submit-message shape (typed per form) vary by caller.
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

	// Defaults to private (the first key), unlike the site's own new-cheat form, which defaults to
	// public. A snippet saved straight out of an editor is less likely to be something meant to
	// publish immediately.
	const visibility = cyclingToggleScript(
		"visibility",
		"visibilityToggle",
		["private", "public"],
		{ private: "Private", public: "Public" },
		{ private: "Click to make public", public: "Click to make private" }
	);

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
		${visibility}
		${validationScript('{ title, typeName, body: { text: bodyEl.value }, private: visibility === "private" }', {
			elementVar: "typeEl",
			valueVar: "typeName",
			hintId: "typeHint",
			maxVar: "TYPE_MAX",
			required: true
		})}
		${LINE_NUMBERS_SCRIPT}
	`;

	return openFormPanel("cheatsCreateCheat", "New Cheat", fields, "Save cheat", script, message => ({
		title: message.title as string,
		typeName: message.typeName as string,
		private: !!message.private,
		body: (message.body as { text: string }).text
	}));
}

const CATEGORY_LABELS: Record<TaskCategory, string> = {
	note: "Note",
	list: "List",
	brief: "Brief",
	rules: "Rules",
	memory: "Memory"
};

const SECTION_TITLES: Record<TaskSection, string> = { tasks: "New Task", brain: "New Brain Entry" };
const SECTION_VIEW_TYPES: Record<TaskSection, string> = { tasks: "cheatsCreateTask", brain: "cheatsCreateBrain" };
const SECTION_SAVE_LABELS: Record<TaskSection, string> = { tasks: "Save task", brain: "Save entry" };

// Serves both the Tasks and the Brain form. The two sections differ only in which categories they
// accept (SECTION_CATEGORIES) and what the panel calls itself, so one form covers both rather than
// a near-identical copy each. Category is a pill, not a text field: the server takes a closed enum
// (resolveCategory in the site's functions/routes/db/tasks.js) and 400s anything else, so cycling
// it makes an invalid value unreachable instead of merely rejected after a round trip.
export function showCreateTaskForm(initialBody: string, section: TaskSection): Promise<TaskFormResult | undefined> {
	const fields = `
<div class="field">
	<label for="title">Title</label>
	<input type="text" id="title" class="uppercase-field" maxlength="${TITLE_MAX_LENGTH}" autofocus />
	<div class="hint" id="titleHint"></div>
</div>
<div class="row">
	<div class="field">
		<label for="categoryToggle">Category</label>
		<button type="button" id="categoryToggle" class="toggle-btn" title="Click to change category"></button>
	</div>
	<div class="field">
		<label for="durationToggle">Expiry</label>
		<button type="button" id="durationToggle" class="toggle-btn" title="Click to change expiry"></button>
	</div>
</div>${BODY_FIELD_HTML}`;

	const category = cyclingToggleScript("category", "categoryToggle", SECTION_CATEGORIES[section], CATEGORY_LABELS);
	const duration = cyclingToggleScript("duration", "durationToggle", ["permanent", "1h", "1d", "1w"], {
		permanent: "Permanent",
		"1h": "1 hour",
		"1d": "1 day",
		"1w": "1 week"
	});

	const script = `
		const TITLE_MAX = ${TITLE_MAX_LENGTH};
		const BODY_MAX_LINES = ${BODY_MAX_LINES};
		const BODY_MAX_LINE_LENGTH = ${BODY_MAX_LINE_LENGTH};
		const MAX_RECORD_BYTES = ${MAX_RECORD_SIZE_BYTES};

		const titleEl = document.getElementById("title");
		const bodyEl = document.getElementById("body");
		const saveBtn = document.getElementById("saveBtn");

		bodyEl.value = ${jsStringLiteral(initialBody)};
		${category}
		${duration}
		${validationScript("{ title, category, text: bodyEl.value, duration }")}
		${LINE_NUMBERS_SCRIPT}
	`;

	return openFormPanel(
		SECTION_VIEW_TYPES[section],
		SECTION_TITLES[section],
		fields,
		SECTION_SAVE_LABELS[section],
		script,
		message => ({
			title: message.title as string,
			category: message.category as TaskCategory,
			text: message.text as string,
			duration: message.duration as TaskDuration
		})
	);
}
