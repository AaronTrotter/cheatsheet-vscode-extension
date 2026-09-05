import * as vscode from "vscode";
import {
	ApiError,
	NewCheat,
	NewTask,
	TaskSection,
	addCheat,
	addTask,
	getCheatBody,
	getGuides,
	searchCheats,
	searchTasks,
	setApiKey
} from "./api";
import { showCreateCheatForm, showCreateTaskForm } from "./webviewForm";

const TRIGGER = /\/cheats\s+(\S.*)$/;
const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

class CheatsCompletionProvider implements vscode.CompletionItemProvider {
	private requestSeq = 0;
	private lastErrorShownAt = 0;

	constructor(private readonly secrets: vscode.SecretStorage) {}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.CompletionList | undefined> {
		const prefix = document.lineAt(position).text.slice(0, position.character);
		const match = TRIGGER.exec(prefix);
		if (!match) return undefined;

		const query = match[1].trim();
		if (query.length < MIN_QUERY_LENGTH) return new vscode.CompletionList([], true);

		const seq = ++this.requestSeq;
		await new Promise(resolve => setTimeout(resolve, DEBOUNCE_MS));
		if (token.isCancellationRequested || seq !== this.requestSeq) return undefined;

		const controller = abortControllerFor(token);

		const triggerStart = prefix.length - match[0].length;
		const range = new vscode.Range(position.line, triggerStart, position.line, position.character);

		try {
			const results = await searchCheats(query, this.secrets, controller.signal);
			if (token.isCancellationRequested || seq !== this.requestSeq) return undefined;

			const items = results.map((r, index) => {
				const item = new vscode.CompletionItem(r.title, vscode.CompletionItemKind.Snippet);
				item.detail = r.type + (r.private ? " (private)" : "");
				item.documentation = new vscode.MarkdownString("```\n" + r.snippet + "\n```");
				item.range = range;
				item.insertText = r.snippet;
				// Swapped for the full body on selection, since /mcp/search only returns a
				// truncated snippet.
				(item as vscode.CompletionItem & { cheatId: string }).cheatId = r.id;
				// Preserve Algolia's relevance order instead of VS Code's default alphabetical sort.
				item.sortText = String(index).padStart(4, "0");
				return item;
			});
			return new vscode.CompletionList(items, true);
		} catch (error) {
			this.showErrorOnce(error);
			return new vscode.CompletionList([], true);
		}
	}

	async resolveCompletionItem(
		item: vscode.CompletionItem,
		token: vscode.CancellationToken
	): Promise<vscode.CompletionItem> {
		const cheatId = (item as vscode.CompletionItem & { cheatId?: string }).cheatId;
		if (!cheatId) return item;

		const controller = abortControllerFor(token);
		try {
			const fullText = await getCheatBody(cheatId, this.secrets, controller.signal);
			item.insertText = fullText;
		} catch (error) {
			this.showErrorOnce(error);
		}
		return item;
	}

	// Same message as showApiError, but silent on cancellation and capped at one message every five
	// seconds, because this runs on every keystroke, so an offline or misconfigured client would otherwise
	// stack up a notification per character typed.
	private showErrorOnce(error: unknown) {
		if (isAbortError(error)) return;
		const now = Date.now();
		if (now - this.lastErrorShownAt < 5000) return;
		this.lastErrorShownAt = now;
		showApiError(error);
	}
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

// Bridges a VS Code cancellation token to the AbortSignal the api module takes.
function abortControllerFor(token: vscode.CancellationToken): AbortController {
	const controller = new AbortController();
	token.onCancellationRequested(() => controller.abort());
	return controller;
}

// Reused by every search command: an explicit selection wins, otherwise falls back to the word
// under the cursor (if any), so a bare cursor placement still gives a sensible search seed/replace
// target instead of requiring a manual selection.
function getSelectionOrWordRange(editor: vscode.TextEditor | undefined): vscode.Range | undefined {
	if (!editor) return undefined;
	const selection = editor.selection;
	if (!selection.isEmpty) return selection;
	return editor.document.getWordRangeAtPosition(selection.active);
}

// Reused by every create command to seed the form's body from the active selection, if any.
function getSelectedText(editor: vscode.TextEditor | undefined): string {
	return editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : "";
}

async function insertOrReplace(editor: vscode.TextEditor, range: vscode.Range | undefined, text: string): Promise<void> {
	await editor.edit(editBuilder => {
		if (range) {
			editBuilder.replace(range, text);
		} else {
			editBuilder.insert(editor.selection.active, text);
		}
	});
}

function showApiError(error: unknown): void {
	const message = error instanceof ApiError ? error.message : String(error);
	vscode.window.showErrorMessage(`Cheatsheet Sidekick: ${message}`);
}

// Shared by search and create commands: runs `action` under a cancellable progress notification,
// swallowing the AbortError that results from the user cancelling (undefined return means
// "cancelled, nothing more to do") while letting any other error (e.g. ApiError) propagate for the
// caller to handle on its own terms (create commands special-case 401, search commands don't).
async function withCancellableProgress<T>(title: string, action: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
	const controller = new AbortController();
	try {
		return await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title, cancellable: true },
			(_progress, token) => {
				token.onCancellationRequested(() => controller.abort());
				return action(controller.signal);
			}
		);
	} catch (error) {
		if (isAbortError(error)) return undefined;
		throw error;
	}
}

interface SearchFlow<T> {
	/** Names the section in the input box, progress and messages, e.g. "Cheats", "Tasks", "Brain". */
	label: string;
	prompt: string;
	pickTitle: string;
	emptyMessage: string;
	/** Cheats search a non-empty selection straight off; Tasks and Brain always confirm the query. */
	useSelectionDirectly: boolean;
	/** Tasks and Brain accept a blank query to browse the most recent; cheat search needs one. */
	allowBlankQuery: boolean;
	search: (query: string, signal: AbortSignal) => Promise<T[]>;
	toItem: (result: T) => { label: string; description?: string; detail: string };
	/** Cheats fetch the full body lazily on pick; tasks and Brain entries already carry their text. */
	resolveText: (result: T, signal: AbortSignal) => Promise<string>;
}

// Shared by all three search commands, which otherwise differ only in wording and in which API
// call they make: seed a query from the selection or the word under the cursor, search under a
// cancellable progress notification, offer the results in a quick pick, then replace the seed
// range (or insert at the cursor) with whatever was picked.
async function searchAndInsertCommand<T>(flow: SearchFlow<T>): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;

	const range = getSelectionOrWordRange(editor);

	let query: string;
	if (flow.useSelectionDirectly && !editor.selection.isEmpty) {
		query = editor.document.getText(editor.selection).trim();
		if (query.length < MIN_QUERY_LENGTH) return;
	} else {
		const seed = range ? editor.document.getText(range) : "";
		const input = await vscode.window.showInputBox({
			title: `Cheatsheet Sidekick: Search ${flow.label}`,
			prompt: flow.prompt,
			value: seed,
			valueSelection: seed ? [0, seed.length] : undefined,
			ignoreFocusOut: true,
			validateInput: value => {
				const trimmed = value.trim();
				if (flow.allowBlankQuery && trimmed.length === 0) return undefined;
				if (trimmed.length >= MIN_QUERY_LENGTH) return undefined;
				return flow.allowBlankQuery
					? `Enter at least ${MIN_QUERY_LENGTH} characters, or leave blank to browse your most recent.`
					: `Enter at least ${MIN_QUERY_LENGTH} characters to search.`;
			}
		});
		if (input === undefined) return;
		query = input.trim();
	}

	let results: T[] | undefined;
	try {
		results = await withCancellableProgress(`Cheatsheet Sidekick: Searching ${flow.label}…`, signal => flow.search(query, signal));
	} catch (error) {
		showApiError(error);
		return;
	}
	if (results === undefined) return;

	if (results.length === 0) {
		vscode.window.showInformationMessage(flow.emptyMessage);
		return;
	}

	const picked = await vscode.window.showQuickPick(
		results.map(result => ({ ...flow.toItem(result), result })),
		{ title: flow.pickTitle, matchOnDescription: true, matchOnDetail: true }
	);
	if (!picked) return;

	let text: string;
	try {
		text = await flow.resolveText(picked.result, new AbortController().signal);
	} catch (error) {
		showApiError(error);
		return;
	}

	await insertOrReplace(editor, range, text);
}

type EntityName = "cheat" | "task" | "brain entry";

// Shared by all three create commands: runs the save under progress, then handles the three
// outcomes they have in common (cancelled, needs-Pro 401, any other ApiError) the same way,
// leaving only the entity-specific naming and the save call itself to the caller.
async function saveEntityCommand(
	secrets: vscode.SecretStorage,
	entityName: EntityName,
	title: string,
	save: (signal: AbortSignal) => Promise<string>
): Promise<void> {
	let id: string | undefined;
	try {
		id = await withCancellableProgress(`Cheatsheet Sidekick: Saving ${entityName}…`, save);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) {
			const choice = await vscode.window.showErrorMessage(
				`Cheatsheet Sidekick: Creating a ${entityName} needs a Pro account and a read + write API key. Either your key ` +
					"doesn't have write access, is out of date, or your account isn't Pro yet.",
				"Set API Key",
				"Upgrade to Pro"
			);
			if (choice === "Set API Key") await setApiKey(secrets);
			else if (choice === "Upgrade to Pro") {
				await vscode.env.openExternal(vscode.Uri.parse("https://cheats.aarontrotter.com/billing"));
			}
			return;
		}
		showApiError(error);
		return;
	}
	if (id === undefined) return;
	vscode.window.showInformationMessage(`Cheatsheet Sidekick: Saved ${entityName} "${title}" (${id}).`);
}

function searchCheatsCommand(secrets: vscode.SecretStorage): Promise<void> {
	return searchAndInsertCommand({
		label: "Cheats",
		prompt: "Search your cheatsheet site",
		pickTitle: "Cheatsheet Sidekick: Select a result to insert",
		emptyMessage: "Cheatsheet Sidekick: No results found.",
		useSelectionDirectly: true,
		allowBlankQuery: false,
		search: (query, signal) => searchCheats(query, secrets, signal),
		toItem: r => ({
			label: r.title,
			description: r.type + (r.private ? " (private)" : ""),
			detail: r.snippet.replace(/\s+/g, " ").trim()
		}),
		resolveText: (r, signal) => getCheatBody(r.id, secrets, signal)
	});
}

async function createCheatCommand(secrets: vscode.SecretStorage): Promise<void> {
	const initialBody = getSelectedText(vscode.window.activeTextEditor);

	const form = await showCreateCheatForm(initialBody);
	if (!form) return;

	const cheat: NewCheat = {
		title: form.title,
		typeName: form.typeName,
		body: { text: form.body },
		private: form.private
	};

	await saveEntityCommand(secrets, "cheat", cheat.title, signal => addCheat(cheat, secrets, signal));
}

// Tasks and Brain are separate sections of the site sharing one backing collection, split by
// category (SECTION_CATEGORIES in ./api). The extension keeps them separate too: each gets its own
// pair of commands, and every request names its section so a Tasks search never turns up the
// user's brief/rules/memory entries, or the reverse.
const SECTION_LABELS: Record<TaskSection, string> = { tasks: "Tasks", brain: "Brain" };
const SECTION_ENTITY_NAMES: Record<TaskSection, EntityName> = { tasks: "task", brain: "brain entry" };
const SECTION_PICK_NOUNS: Record<TaskSection, string> = { tasks: "a task", brain: "an entry" };

function searchSectionCommand(secrets: vscode.SecretStorage, section: TaskSection): Promise<void> {
	const label = SECTION_LABELS[section];
	return searchAndInsertCommand({
		label,
		prompt: `Search your ${label} (leave blank to browse your most recent)`,
		pickTitle: `Cheatsheet Sidekick: Select ${SECTION_PICK_NOUNS[section]} to insert`,
		emptyMessage: `Cheatsheet Sidekick: No ${label} entries found.`,
		useSelectionDirectly: false,
		allowBlankQuery: true,
		search: (query, signal) => searchTasks(query, section, secrets, signal),
		toItem: t => ({
			label: t.title,
			description: t.category || undefined,
			detail: t.text.replace(/\s+/g, " ").trim()
		}),
		resolveText: async t => t.text
	});
}

async function createSectionCommand(secrets: vscode.SecretStorage, section: TaskSection): Promise<void> {
	const initialBody = getSelectedText(vscode.window.activeTextEditor);

	const form = await showCreateTaskForm(initialBody, section);
	if (!form) return;

	const task: NewTask = {
		title: form.title,
		category: form.category,
		text: form.text,
		duration: form.duration
	};

	await saveEntityCommand(secrets, SECTION_ENTITY_NAMES[section], task.title, signal => addTask(task, secrets, signal));
}

// The user's own brief and rules, pre-formatted as markdown by the server (buildGuidesText in the
// site's functions/routes/db/mcp.js). This is the same text the site hands an MCP client on connect, which
// makes it the thing to drop into a CLAUDE.md or AGENTS.md.
async function insertGuidesCommand(secrets: vscode.SecretStorage): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;

	let guides: string | undefined;
	try {
		guides = await withCancellableProgress("Cheatsheet Sidekick: Fetching Guides…", signal => getGuides(secrets, signal));
	} catch (error) {
		showApiError(error);
		return;
	}
	if (guides === undefined) return;

	// The endpoint answers with an empty string rather than an error when there's nothing to send,
	// which would otherwise look like the command silently doing nothing.
	if (!guides.trim()) {
		vscode.window.showInformationMessage(
			"Cheatsheet Sidekick: No guides yet. Add a Brief or Rules entry to your Brain first."
		);
		return;
	}

	await insertOrReplace(editor, undefined, guides);
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new CheatsCompletionProvider(context.secrets);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider({ pattern: "**" }, provider, " "),
		vscode.commands.registerCommand("cheats.setApiKey", () => setApiKey(context.secrets)),
		vscode.commands.registerCommand("cheats.searchCheats", () => searchCheatsCommand(context.secrets)),
		vscode.commands.registerCommand("cheats.createCheat", () => createCheatCommand(context.secrets)),
		vscode.commands.registerCommand("cheats.searchTasks", () => searchSectionCommand(context.secrets, "tasks")),
		vscode.commands.registerCommand("cheats.createTask", () => createSectionCommand(context.secrets, "tasks")),
		vscode.commands.registerCommand("cheats.searchBrain", () => searchSectionCommand(context.secrets, "brain")),
		vscode.commands.registerCommand("cheats.createBrain", () => createSectionCommand(context.secrets, "brain")),
		vscode.commands.registerCommand("cheats.insertGuides", () => insertGuidesCommand(context.secrets))
	);
}

export function deactivate() {}
