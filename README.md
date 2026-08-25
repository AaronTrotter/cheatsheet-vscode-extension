# Cheats

Search, insert, and save snippets from [Cheatsheet](https://cheats.aarontrotter.com) without leaving VS Code.

Cheatsheet is a personal cheat-sheet web app for storing code and command snippets ("cheats"), searchable and organized by type. This extension talks to its API so you can pull a snippet into your editor, or push a new one back up, without switching to the browser.

## Setup

1. On [cheats.aarontrotter.com](https://cheats.aarontrotter.com), sign in and go to `/user` to generate an API key from the API Access section. This requires a Pro account, since the API is a Pro-only feature. Choose read-only if you just want to search, or read + write if you also want to create cheats from VS Code.
2. In VS Code, open the Command Palette and run `Cheats: Set API Key`, then paste the key in. It's stored in VS Code's SecretStorage, not in a settings file.
3. If you run your own fork of Cheatsheet elsewhere, set `cheats.baseUrl` in your VS Code settings to point at it.

## Search while you type

Type `/cheats` followed by your search terms anywhere in an editor, for example `/cheats react hook`. After a couple of characters, IntelliSense lists matching cheats, ranked by relevance. Accept a suggestion to replace what you typed with the full snippet.

## Search a selection

Select some text (or just place your cursor in a word) and run `Cheats: Search Selection` (`Ctrl+Alt+/`, or `Cmd+Alt+/` on Mac). It fills a search box with your selection, shows the matches in a quick-pick list, and replaces the selection with whichever result you choose.

## Save a snippet

Select the code you want to keep and run `Cheats: Create Cheat from Selection` (`Ctrl+Alt+.`, or `Cmd+Alt+.` on Mac). You'll be prompted for a title, a type (an existing one or a new one), and whether the cheat should be private, then the selection is saved as the cheat's body. This needs a read + write API key (see Setup) and follows the same limits as the API:

- Title: required, 40 characters max
- Type: required, 15 characters max
- Body: 100 lines max, 600 characters per line max
- Whole cheat: 10KB max

## Notes

- Search uses the same `/mcp/search` and `/mcp/getCheat` endpoints as Cheatsheet's Model Context Protocol integration, so usage counts against the same shared daily quota (500 requests per account per day). Full API details are documented at [cheats.aarontrotter.com/api-docs](https://cheats.aarontrotter.com/api-docs).
- Results only include cheats you can normally see: your own private ones plus everything public.

## Developing

```
npm install
npm run compile
```

Then press F5 to launch an Extension Development Host with the extension loaded.
