# Cheats

Search, insert, and save snippets from [Cheatsheet](https://cheats.aarontrotter.com) without leaving VS Code.

[Cheatsheet](https://cheats.aarontrotter.com) is a personal cheat-sheet web app for storing code and command snippets ("cheats"), searchable and organized by type. This extension connects to your Cheatsheet account so you can pull a snippet straight into your editor, or push a new one back up, without switching to the browser.

**Free to search.** A free Cheatsheet account is all you need for search and insert, no card required. Creating cheats from VS Code needs a Pro plan, see [Plans and limits](#plans-and-limits) below.

## Getting started

1. On [cheats.aarontrotter.com](https://cheats.aarontrotter.com), sign in (or create a free account) and go to `/user`. In the API Access section, generate an API key. Pick read-only if you just want to search, or read + write if you also want to create cheats from VS Code (Pro required for write, see below).
2. Back in VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run `Cheats: Set API Key`, then paste the key in. It's kept in VS Code's secure SecretStorage, never written to a settings file.
3. You're set. Try typing `/cheats` in any file to search.

## What you can do

### Search while you type

Type `/cheats` followed by your search terms anywhere in an editor, for example `/cheats react hook`. After a couple of characters, IntelliSense lists matching cheats, ranked by relevance. Accept a suggestion and it replaces what you typed with the full snippet.

### Search a selection

Select some text (or just place your cursor in a word) and run `Cheats: Search Selection` (`Ctrl+Alt+/`, or `Cmd+Alt+/` on Mac). It fills a search box with your selection, shows the matches in a quick-pick list, and replaces the selection with whichever result you choose.

### Save a snippet back to Cheatsheet

Select the code you want to keep and run `Cheats: Create Cheat from Selection` (`Ctrl+Alt+.`, or `Cmd+Alt+.` on Mac). You'll be asked for a title, a type (pick an existing one or type a new one), and whether it should be private, then your selection is saved as the cheat's body.

This needs a **Pro** account and a read + write API key (see [Plans and limits](#plans-and-limits)). A few limits apply to the cheat itself, matching Cheatsheet's own rules:

- Title: required, 40 characters max
- Type: required, 15 characters max
- Body: 100 lines max, 600 characters per line max
- Whole cheat: 10KB max

## Plans and limits

Cheatsheet has a free tier, and this extension's search and insert features work on it:

| | Free | Pro (€2/month or €20/year) |
|---|---|---|
| Search & insert (this extension) | ✅ | ✅ |
| Create cheats (this extension) | ❌ | ✅ |
| API requests per day | 50 | 500 |

Want to create cheats from VS Code? [Upgrade to Pro on the billing page](https://cheats.aarontrotter.com/billing). Pro also unlocks Vault (encrypted private notes) and Tasks on the site itself, alongside the higher API quota.

A couple of other things worth knowing:

- Search only shows cheats you can normally see: your own private ones, plus everything public.
- The daily API quota is shared across everything using your key, including Cheatsheet's Model Context Protocol integration if you use that too. Full API details live at [cheats.aarontrotter.com/api-docs](https://cheats.aarontrotter.com/api-docs).
- Already have your own fork of Cheatsheet running elsewhere? Point `cheats.baseUrl` in your VS Code settings at it instead.

## Contributing

Want to work on the extension itself rather than just use it? Clone [the repo](https://github.com/AaronTrotter/cheatsheet-vscode-extension), run `npm install`, then press F5 in VS Code to launch an Extension Development Host with your changes loaded (it builds automatically first). Use `npm run watch` while actively editing to recompile on save.
