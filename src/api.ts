import * as vscode from "vscode";

const SECRET_KEY = "cheats.apiKey";

export interface SearchResult {
	id: string;
	title: string;
	type: string;
	snippet: string;
	private: boolean;
	stars: number;
	points: number;
}

interface SearchResponse {
	results: SearchResult[];
}

interface GetCheatResponse {
	id: string;
	title: string;
	type: string;
	body: { text: string };
}

// Field limits enforced server-side by POST /mcp/addCheat; validated client-side too
// so the user finds out before the request round-trips, not after silent truncation.
export const TITLE_MAX_LENGTH = 40;
export const TYPE_MAX_LENGTH = 15;
export const BODY_MAX_LINES = 100;
export const BODY_MAX_LINE_LENGTH = 600;
export const MAX_RECORD_SIZE_BYTES = 10 * 1024;

export interface NewCheat {
	title: string;
	typeName: string;
	body: { text: string };
	private: boolean;
}

// Both POST /mcp/addCheat and POST /mcp/addTask answer with just the new record's id.
interface AddResponse {
	id: string;
}

export interface TaskResult {
	id: string;
	title: string;
	category: string;
	text: string;
	highlights: string[];
	links: string[];
	createdDateMs: number;
	expiresAtMs: number | null;
}

interface SearchTasksResponse {
	tasks: TaskResult[];
	totalPages: number;
}

interface GuidesResponse {
	guides: string;
}

// Tasks and Brain are two separate sections of the site backed by one collection, split only by
// category: /tasks holds the user's own notes and checklists, /brain holds the AI-facing entries
// (`brief` and `rules` are the user's standing guidance, `memory` is what an assistant records for
// itself). Mirrors TASK_SECTIONS in the site's functions/routes/db/tasks.js. Category is a closed
// enum server-side, so it's a cycling pill in the create forms rather than a text field, an
// unrecognised value is a 400, not a new freeform label the way a cheat's typeName is.
export type TaskSection = "tasks" | "brain";
export type TaskCategory = "note" | "list" | "brief" | "rules" | "memory";

export const SECTION_CATEGORIES: Record<TaskSection, readonly TaskCategory[]> = {
	tasks: ["note", "list"],
	brain: ["brief", "rules", "memory"]
};

export type TaskDuration = "permanent" | "1h" | "1d" | "1w";

export interface NewTask {
	title: string;
	category: TaskCategory;
	text: string;
	duration: TaskDuration;
}

export class ApiError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

export async function getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
	return secrets.get(SECRET_KEY);
}

export async function setApiKey(secrets: vscode.SecretStorage): Promise<void> {
	const key = await vscode.window.showInputBox({
		title: "Cheatsheet Sidekick: Set API Key",
		prompt: "Paste an API key from cheats.aarontrotter.com/user. A free account covers a read-scoped " +
			"key for search; creating cheats needs a read + write key, which requires Pro (cheats.aarontrotter.com/billing).",
		password: true,
		ignoreFocusOut: true
	});
	if (key) {
		await secrets.store(SECRET_KEY, key.trim());
		vscode.window.showInformationMessage("Cheatsheet Sidekick: API key saved.");
	}
}

function baseUrl(): string {
	return vscode.workspace.getConfiguration("cheats").get<string>("baseUrl", "").replace(/\/+$/, "");
}

async function request<T>(path: string, secrets: vscode.SecretStorage, signal: AbortSignal, init?: RequestInit): Promise<T> {
	const apiKey = await getApiKey(secrets);
	if (!apiKey) {
		throw new ApiError(401, "No API key set. Run 'Cheatsheet Sidekick: Set API Key' first.");
	}
	const res = await fetch(`${baseUrl()}${path}`, {
		...init,
		// X-Cheatsheet-Client is purely informational, read server-side for the /user page's
		// per-client usage breakdown (see functions/dbHelpers.js's getClientId in the main repo).
		// Safe against an older server that doesn't recognize it.
		headers: { Authorization: `Bearer ${apiKey}`, "X-Cheatsheet-Client": "vscode-extension", ...(init?.headers ?? {}) },
		signal
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new ApiError(res.status, (body as { error?: string }).error || res.statusText);
	}
	return res.json() as Promise<T>;
}

// Shared by both create calls: same method, same content type, same { id } response, so only the
// path and payload differ.
async function post(path: string, payload: unknown, secrets: vscode.SecretStorage, signal: AbortSignal): Promise<string> {
	const data = await request<AddResponse>(path, secrets, signal, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	});
	return data.id;
}

export async function searchCheats(
	query: string,
	secrets: vscode.SecretStorage,
	signal: AbortSignal
): Promise<SearchResult[]> {
	const limit = vscode.workspace.getConfiguration("cheats").get<number>("limit", 10);
	const params = new URLSearchParams({ q: query, limit: String(limit) });
	const data = await request<SearchResponse>(`/mcp/search?${params}`, secrets, signal);
	return data.results;
}

export async function getCheatBody(
	id: string,
	secrets: vscode.SecretStorage,
	signal: AbortSignal
): Promise<string> {
	const params = new URLSearchParams({ id });
	const data = await request<GetCheatResponse>(`/mcp/getCheat?${params}`, secrets, signal);
	return data.body.text;
}

export async function addCheat(
	cheat: NewCheat,
	secrets: vscode.SecretStorage,
	signal: AbortSignal
): Promise<string> {
	return post("/mcp/addCheat", cheat, secrets, signal);
}

// `section` is what keeps Tasks and Brain apart: omitting it searches across both, which would let
// a Tasks search turn up the user's brief/rules/memory entries.
export async function searchTasks(
	query: string,
	section: TaskSection,
	secrets: vscode.SecretStorage,
	signal: AbortSignal
): Promise<TaskResult[]> {
	const params = new URLSearchParams({ section });
	if (query) params.set("q", query);
	const data = await request<SearchTasksResponse>(`/mcp/searchTasks?${params}`, secrets, signal);
	return data.tasks;
}

export async function addTask(
	task: NewTask,
	secrets: vscode.SecretStorage,
	signal: AbortSignal
): Promise<string> {
	return post("/mcp/addTask", task, secrets, signal);
}

// The user's own standing guidance (their Brain's `brief` and `rules` entries, `memory` excluded)
// pre-formatted server-side as markdown. This is the same text the site hands an MCP client on connect.
// Returns "" when they have no such entries yet.
export async function getGuides(secrets: vscode.SecretStorage, signal: AbortSignal): Promise<string> {
	const data = await request<GuidesResponse>("/mcp/getGuides", secrets, signal);
	return data.guides;
}
