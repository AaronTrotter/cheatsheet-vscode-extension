import * as vscode from "vscode";
import {
	ApiError,
	NewCheat,
	NewTask,
	addCheat,
	addTask,
	getCheatBody,
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

		const controller = new AbortController();
		token.onCancellationRequested(() => controller.abort());

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

		const controller = new AbortController();
		token.onCancellationRequested(() => controller.abort());
		try {
			const fullText = await getCheatBody(cheatId, this.secrets, controller.signal);
			item.insertText = fullText;
		} catch (error) {
			this.showErrorOnce(error);
		}
		return item;
	}

	private showErrorOnce(error: unknown) {
		if (error instanceof Error && error.name === "AbortError") return;
		const now = Date.now();
		if (now - this.lastErrorShownAt < 5000) return;
		this.lastErrorShownAt = now;
		const message = error instanceof ApiError ? error.message : String(error);
		vscode.window.showErrorMessage(`Cheatsheet Sidekick: ${message}`);
	}
}

// Reused by both search commands: an explicit selection wins, otherwise falls back to the word
// under the cursor (if any), so a bare cursor placement still gives a sensible search seed/replace
// target instead of requiring a manual selection.
function getSelectionOrWordRange(editor: vscode.TextEditor | undefined): vscode.Range | undefined {
	if (!editor) return undefined;
	const selection = editor.selection;
	if (!selection.isEmpty) return selection;
	return editor.document.getWordRangeAtPosition(selection.active);
}

// Reused by both create commands to seed the form's body from the active selection, if any.
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
		if (error instanceof Error && error.name === "AbortError") return undefined;
		throw error;
	}
}

async function searchCheatsCommand(secrets: vscode.SecretStorage): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;

	const range = getSelectionOrWordRange(editor);

	let query: string;
	if (!editor.selection.isEmpty) {
		query = editor.document.getText(editor.selection).trim();
		if (query.length < MIN_QUERY_LENGTH) return;
	} else {
		const wordText = range ? editor.document.getText(range) : "";
		const input = await vscode.window.showInputBox({
			title: "Cheatsheet Sidekick: Search Cheats",
			prompt: "Search your cheatsheet site",
			value: wordText,
			valueSelection: wordText ? [0, wordText.length] : undefined,
			ignoreFocusOut: true,
			validateInput: value =>
				value.trim().length < MIN_QUERY_LENGTH ? `Enter at least ${MIN_QUERY_LENGTH} characters to search.` : undefined
		});
		if (!input) return;
		query = input.trim();
	}

	let results;
	try {
		results = await withCancellableProgress("Cheatsheet Sidekick: Searching…", signal => searchCheats(query, secrets, signal));
	} catch (error) {
		showApiError(error);
		return;
	}
	if (results === undefined) return;

	if (results.length === 0) {
		vscode.window.showInformationMessage("Cheatsheet Sidekick: No results found.");
		return;
	}

	const picked = await vscode.window.showQuickPick(
		results.map(r => ({
			label: r.title,
			description: r.type + (r.private ? " (private)" : ""),
			detail: r.snippet.replace(/\s+/g, " ").trim(),
			result: r
		})),
		{ title: "Cheatsheet Sidekick: Select a result to insert", matchOnDescription: true, matchOnDetail: true }
	);
	if (!picked) return;

	let body: string;
	try {
		body = await getCheatBody(picked.result.id, secrets, new AbortController().signal);
	} catch (error) {
		showApiError(error);
		return;
	}

	await insertOrReplace(editor, range, body);
}

// Shared by both create commands: runs the save under progress, then handles the three outcomes
// they have in common (cancelled, needs-Pro 401, any other ApiError) the same way, leaving only
// the entity-specific naming and the save call itself to the caller.
async function saveEntityCommand(
	secrets: vscode.SecretStorage,
	entityName: "cheat" | "task",
	progressTitle: string,
	title: string,
	save: (signal: AbortSignal) => Promise<string>
): Promise<void> {
	let id: string | undefined;
	try {
		id = await withCancellableProgress(progressTitle, save);
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

	await saveEntityCommand(secrets, "cheat", "Cheatsheet Sidekick: Saving…", cheat.title, signal => addCheat(cheat, secrets, signal));
}

async function searchTasksCommand(secrets: vscode.SecretStorage): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	const range = getSelectionOrWordRange(editor);
	const query = range && editor ? editor.document.getText(range) : "";

	const input = await vscode.window.showInputBox({
		title: "Cheatsheet Sidekick: Search Tasks",
		prompt: "Search your Tasks (leave blank to browse your most recent)",
		value: query,
		valueSelection: query ? [0, query.length] : undefined,
		ignoreFocusOut: true,
		validateInput: value => {
			const trimmed = value.trim();
			return trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH
				? `Enter at least ${MIN_QUERY_LENGTH} characters, or leave blank to browse your most recent.`
				: undefined;
		}
	});
	if (input === undefined) return;

	let results;
	try {
		results = await withCancellableProgress("Cheatsheet Sidekick: Searching Tasks…", signal => searchTasks(input.trim(), secrets, signal));
	} catch (error) {
		showApiError(error);
		return;
	}
	if (results === undefined) return;

	if (results.length === 0) {
		vscode.window.showInformationMessage("Cheatsheet Sidekick: No tasks found.");
		return;
	}

	const picked = await vscode.window.showQuickPick(
		results.map(t => ({
			label: t.title,
			description: t.category || undefined,
			detail: t.text.replace(/\s+/g, " ").trim(),
			task: t
		})),
		{ title: "Cheatsheet Sidekick: Select a task to insert", matchOnDescription: true, matchOnDetail: true }
	);
	if (!picked) return;

	if (!editor) return;
	await insertOrReplace(editor, range, picked.task.text);
}

async function createTaskCommand(secrets: vscode.SecretStorage): Promise<void> {
	const initialBody = getSelectedText(vscode.window.activeTextEditor);

	const form = await showCreateTaskForm(initialBody);
	if (!form) return;

	const task: NewTask = {
		title: form.title,
		category: form.category,
		text: form.text,
		duration: form.duration
	};

	await saveEntityCommand(secrets, "task", "Cheatsheet Sidekick: Saving Task…", task.title, signal => addTask(task, secrets, signal));
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new CheatsCompletionProvider(context.secrets);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider({ pattern: "**" }, provider, " "),
		vscode.commands.registerCommand("cheats.setApiKey", () => setApiKey(context.secrets)),
		vscode.commands.registerCommand("cheats.searchCheats", () => searchCheatsCommand(context.secrets)),
		vscode.commands.registerCommand("cheats.createCheat", () => createCheatCommand(context.secrets)),
		vscode.commands.registerCommand("cheats.searchTasks", () => searchTasksCommand(context.secrets)),
		vscode.commands.registerCommand("cheats.createTask", () => createTaskCommand(context.secrets))
	);
}

export function deactivate() {}
