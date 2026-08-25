import * as vscode from "vscode";
import {
	ApiError,
	BODY_MAX_LINE_LENGTH,
	BODY_MAX_LINES,
	MAX_RECORD_SIZE_BYTES,
	NewCheat,
	TITLE_MAX_LENGTH,
	TYPE_MAX_LENGTH,
	addCheat,
	getCheatBody,
	searchCheats,
	setApiKey
} from "./api";

const TRIGGER = /\/cheats\s+(\S.*)$/;
const DEBOUNCE_MS = 250;

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
		if (query.length < 2) return new vscode.CompletionList([], true);

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
		vscode.window.showErrorMessage(`Cheats: ${message}`);
	}
}

async function searchSelectionCommand(secrets: vscode.SecretStorage): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) return;

	const selection = editor.selection;
	const wordRange = selection.isEmpty
		? editor.document.getWordRangeAtPosition(selection.active)
		: undefined;
	const range = selection.isEmpty ? wordRange : selection;
	const query = range ? editor.document.getText(range) : "";

	const input = await vscode.window.showInputBox({
		title: "Cheats: Search",
		prompt: "Search your cheatsheet site",
		value: query,
		valueSelection: query ? [0, query.length] : undefined,
		ignoreFocusOut: true
	});
	if (!input || !input.trim()) return;

	const controller = new AbortController();
	let results;
	try {
		results = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "Cheats: Searching…", cancellable: true },
			(_progress, token) => {
				token.onCancellationRequested(() => controller.abort());
				return searchCheats(input.trim(), secrets, controller.signal);
			}
		);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		const message = error instanceof ApiError ? error.message : String(error);
		vscode.window.showErrorMessage(`Cheats: ${message}`);
		return;
	}

	if (results.length === 0) {
		vscode.window.showInformationMessage("Cheats: No results found.");
		return;
	}

	const picked = await vscode.window.showQuickPick(
		results.map(r => ({
			label: r.title,
			description: r.type + (r.private ? " (private)" : ""),
			detail: r.snippet.replace(/\s+/g, " ").trim(),
			result: r
		})),
		{ title: "Cheats: Select a result to insert", matchOnDescription: true, matchOnDetail: true }
	);
	if (!picked) return;

	let body: string;
	try {
		body = await getCheatBody(picked.result.id, secrets, controller.signal);
	} catch (error) {
		const message = error instanceof ApiError ? error.message : String(error);
		vscode.window.showErrorMessage(`Cheats: ${message}`);
		return;
	}

	await editor.edit(editBuilder => {
		if (range) {
			editBuilder.replace(range, body);
		} else {
			editBuilder.insert(editor.selection.active, body);
		}
	});
}

async function createCheatCommand(secrets: vscode.SecretStorage): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	const body = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined;
	if (!body) {
		vscode.window.showErrorMessage("Cheats: Select the code/text to save as a cheat first.");
		return;
	}

	const lines = body.split(/\r\n|\r|\n/);
	if (lines.length > BODY_MAX_LINES) {
		vscode.window.showErrorMessage(`Cheats: Selection has ${lines.length} lines; cheats are limited to ${BODY_MAX_LINES}.`);
		return;
	}
	const longLine = lines.find(line => line.length > BODY_MAX_LINE_LENGTH);
	if (longLine !== undefined) {
		vscode.window.showErrorMessage(`Cheats: A line in the selection exceeds the ${BODY_MAX_LINE_LENGTH} character limit.`);
		return;
	}

	const title = await vscode.window.showInputBox({
		title: "Cheats: New Cheat (1/3): Title",
		prompt: `Required, max ${TITLE_MAX_LENGTH} characters`,
		ignoreFocusOut: true,
		validateInput: value => {
			if (!value.trim()) return "Title is required.";
			if (value.length > TITLE_MAX_LENGTH) return `Too long: ${value.length}/${TITLE_MAX_LENGTH} characters.`;
			return undefined;
		}
	});
	if (!title) return;

	const typeName = await vscode.window.showInputBox({
		title: "Cheats: New Cheat (2/3): Type",
		prompt: `Required, max ${TYPE_MAX_LENGTH} characters, e.g. "javascript", "git", "regex". Unrecognized types are created automatically.`,
		ignoreFocusOut: true,
		validateInput: value => {
			if (!value.trim()) return "Type is required.";
			if (value.length > TYPE_MAX_LENGTH) return `Too long: ${value.length}/${TYPE_MAX_LENGTH} characters.`;
			return undefined;
		}
	});
	if (!typeName) return;

	const visibility = await vscode.window.showQuickPick(
		[
			{ label: "Private", description: "Only visible to you", isPrivate: true },
			{ label: "Public", description: "Visible to everyone", isPrivate: false }
		],
		{ title: "Cheats: New Cheat (3/3): Visibility", ignoreFocusOut: true }
	);
	if (!visibility) return;

	const cheat: NewCheat = {
		title: title.trim(),
		typeName: typeName.trim(),
		body: { text: body },
		private: visibility.isPrivate
	};

	const recordSize = new TextEncoder().encode(JSON.stringify(cheat)).length;
	if (recordSize > MAX_RECORD_SIZE_BYTES) {
		vscode.window.showErrorMessage(
			`Cheats: This cheat is ${(recordSize / 1024).toFixed(1)}KB, over the ${MAX_RECORD_SIZE_BYTES / 1024}KB limit.`
		);
		return;
	}

	const controller = new AbortController();
	try {
		const id = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "Cheats: Saving…", cancellable: true },
			(_progress, token) => {
				token.onCancellationRequested(() => controller.abort());
				return addCheat(cheat, secrets, controller.signal);
			}
		);
		vscode.window.showInformationMessage(`Cheats: Saved "${cheat.title}" (${id}).`);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		if (error instanceof ApiError && error.status === 401) {
			const choice = await vscode.window.showErrorMessage(
				"Cheats: Creating a cheat needs a Pro account and a read + write API key. Either your key " +
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
		const message = error instanceof ApiError ? error.message : String(error);
		vscode.window.showErrorMessage(`Cheats: ${message}`);
	}
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new CheatsCompletionProvider(context.secrets);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider({ pattern: "**" }, provider, " "),
		vscode.commands.registerCommand("cheats.setApiKey", () => setApiKey(context.secrets)),
		vscode.commands.registerCommand("cheats.searchSelection", () => searchSelectionCommand(context.secrets)),
		vscode.commands.registerCommand("cheats.createCheat", () => createCheatCommand(context.secrets))
	);
}

export function deactivate() {}
