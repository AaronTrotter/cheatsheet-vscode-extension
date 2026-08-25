# Cheats

Search, insert, and save code snippets from your [cheatsheet site](https://aaronscheatsheet.web.app) without leaving VS Code.

## Setup

1. On your cheatsheet site, go to `/user` and generate an API key. This requires a Pro-tier account, since the endpoints this extension uses are Pro-only. A read-scoped key covers search; if you also want to create cheats from VS Code, generate a read + write key instead.
2. In VS Code, open the Command Palette and run `Cheats: Set API Key`, then paste the key in. It's stored in VS Code's SecretStorage, not in a settings file.
3. If your site isn't hosted at `https://aaronscheatsheet.web.app`, set `cheats.baseUrl` in your VS Code settings.

## Search while you type

Type `/cheats` followed by your search terms anywhere in an editor, for example `/cheats react hook`. After a couple of characters, IntelliSense lists matching cheats from your site, ranked by relevance. Accept a suggestion to replace what you typed with the full snippet.

## Search a selection

Select some text (or just place your cursor in a word) and run `Cheats: Search Selection` (`Ctrl+Alt+/`, or `Cmd+Alt+/` on Mac). It fills a search box with your selection, shows the matches in a quick-pick list, and replaces the selection with whichever result you choose.

## Save a snippet

Select the code you want to keep and run `Cheats: Create Cheat from Selection` (`Ctrl+Alt+.`, or `Cmd+Alt+.` on Mac). You'll be prompted for a title, a type (an existing one or a new one), and whether the cheat should be private, then the selection is saved as the cheat's body. This needs a read + write API key (see Setup) and follows the same limits as the site:

- Title: required, 40 characters max
- Type: required, 15 characters max
- Body: 100 lines max, 600 characters per line max
- Whole cheat: 10KB max

## Notes

- Search uses your site's `/mcp/search` and `/mcp/getCheat` endpoints, the same ones behind the Model Context Protocol integration, so usage counts against the same shared daily quota (500 requests per account per day).
- Results only include cheats you'd normally see: your own private ones plus everything public.

## Developing

```
npm install
npm run compile
```

Then press F5 to launch an Extension Development Host with the extension loaded.
