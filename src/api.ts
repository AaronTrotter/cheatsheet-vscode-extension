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

interface AddCheatResponse {
	id: string;
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
		title: "Cheats: Set API Key",
		prompt: "Paste an API key from your cheatsheet site's /user page. Read-only search works with a " +
			"read-scoped key; creating cheats needs a read + write key.",
		password: true,
		ignoreFocusOut: true
	});
	if (key) {
		await secrets.store(SECRET_KEY, key.trim());
		vscode.window.showInformationMessage("Cheats: API key saved.");
	}
}

function baseUrl(): string {
	return vscode.workspace.getConfiguration("cheats").get<string>("baseUrl", "").replace(/\/+$/, "");
}

async function request<T>(path: string, secrets: vscode.SecretStorage, signal: AbortSignal, init?: RequestInit): Promise<T> {
	const apiKey = await getApiKey(secrets);
	if (!apiKey) {
		throw new ApiError(401, "No API key set. Run 'Cheats: Set API Key' first.");
	}
	const res = await fetch(`${baseUrl()}${path}`, {
		...init,
		headers: { Authorization: `Bearer ${apiKey}`, ...(init?.headers ?? {}) },
		signal
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new ApiError(res.status, (body as { error?: string }).error || res.statusText);
	}
	return res.json() as Promise<T>;
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
	const data = await request<AddCheatResponse>("/mcp/addCheat", secrets, signal, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(cheat)
	});
	return data.id;
}
