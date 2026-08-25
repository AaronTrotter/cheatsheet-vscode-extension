# Cheats

Type `/cheats <query>` anywhere in an editor to get inline IntelliSense suggestions pulled live from your cheatsheet site, pick one to insert the full snippet.

## Setup

1. On your cheatsheet site, go to `/user` and generate an API key. Requires a Pro-tier account, the API endpoints this extension calls are Pro-only. A **read-scoped** key is enough for search; if you also want to create cheats from VS Code, generate a **read + write** key instead.
2. In VS Code, run `Cheats: Set API Key` from the Command Palette and paste it in. It's stored in VS Code's SecretStorage, never in a settings file.
3. If your site isn't at `https://aaronscheatsheet.web.app`, set `cheats.baseUrl` in your VS Code settings.

## Use

In any file, type `/cheats react hook` (or whatever you're searching for). After a couple characters, IntelliSense will list matching cheats from your site, ranked by relevance. Accept one to replace the trigger text with the full snippet body.

Alternatively, select some text (or place your cursor in a word) and run **Cheats: Search Selection** (`Ctrl+Alt+/`, or `Cmd+Alt+/` on Mac) from the Command Palette or its keybinding. It pre-fills a search box with your selection, shows matching results in a quick-pick list, and replaces the selection with the chosen snippet's full body.

To save code back to your cheatsheet, select it and run **Cheats: Create Cheat from Selection** (`Ctrl+Alt+.`, or `Cmd+Alt+.` on Mac). You'll be asked for a title, a type (existing or new), and whether it's private, then the selection is saved as the cheat's body. This requires a **read + write** API key (see Setup) and enforces the same limits as the site itself:

- Title: required, max 40 characters
- Type: required, max 15 characters
- Body (your selection): max 100 lines, max 600 characters per line
- Whole cheat: max 10KB

## Develop

```
npm install
npm run compile
```

Press F5 to launch an Extension Development Host with the extension loaded.

## Notes

- Search hits your site's `/mcp/search` and `/mcp/getCheat` endpoints, the same ones the Model Context Protocol integration uses, so it's counted against the same shared daily API quota (500 requests/day per account).
- Only shows cheats you'd normally be able to see: your own private ones plus everything public.
