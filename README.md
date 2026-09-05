# Cheatsheet Sidekick

Search, insert, and save snippets, Tasks, and Brain entries from [Cheatsheet](https://cheats.aarontrotter.com) without leaving VS Code.

[Cheatsheet](https://cheats.aarontrotter.com) is a personal cheat-sheet web app for storing code and command snippets ("cheats"), searchable and organized by type, plus a separate Tasks section for private to-do lists and notes, and a Brain section holding the context, rules, and memories you want an AI assistant to work from. This extension connects to your Cheatsheet account so you can pull a snippet, task, or brain entry straight into your editor, or push a new one back up, without switching to the browser.

**Free to search.** A free Cheatsheet account is all you need for search and insert of both cheats and Tasks, no card required. Creating cheats or Tasks from VS Code needs a Pro plan, see [Plans and limits](#plans-and-limits) below.

## Getting started

1. On [cheats.aarontrotter.com](https://cheats.aarontrotter.com), sign in (or create a free account) and go to `/user`. In the API Access section, generate an API key. Pick read-only if you just want to search, or read + write if you also want to create cheats or Tasks from VS Code (Pro required for write, see below).
2. Back in VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run `Cheatsheet Sidekick: Set API Key`, then paste the key in. It's kept in VS Code's secure SecretStorage, never written to a settings file.
3. You're set. Try typing `/cheats` in any file to search.

## What you can do

### Search while you type

Type `/cheats` followed by your search terms anywhere in an editor, for example `/cheats react hook`. After a couple of characters, IntelliSense lists matching cheats, ranked by relevance. Accept a suggestion and it replaces what you typed with the full snippet.

### Search Cheats

Select some text and run `Cheatsheet Sidekick: Search Cheats` (`Ctrl+Alt+/`, or `Cmd+Alt+/` on Mac) to search on it right away. With no selection, it fills a search box from the word under your cursor instead so you can edit it before searching. Either way you get a quick-pick list of matches, and picking one replaces the selection (or inserts at the cursor) with the full snippet.

### Save a snippet back to Cheatsheet

Run `Cheatsheet Sidekick: Create Cheat` (`Ctrl+Alt+.`, or `Cmd+Alt+.` on Mac) from any editor, selection or not. It opens a form in a new tab with all the fields at once: title, type (pick an existing one or type a new one), a visibility toggle (private by default), and the body, pre-filled from your selection if you had one. Fill it in and click Save cheat.

### Search Tasks

Select some text (or just place your cursor in a word) and run `Cheatsheet Sidekick: Search Tasks` (`Ctrl+Alt+Shift+/`, or `Cmd+Alt+Shift+/` on Mac). Leave the search box blank to browse your most recently created Tasks instead. Pick a result from the quick-pick list and its full text replaces the selection.

### Save a task back to Cheatsheet

Run `Cheatsheet Sidekick: Create Task` (`Ctrl+Alt+Shift+.`, or `Cmd+Alt+Shift+.` on Mac) from any editor, selection or not. It opens a form in a new tab with all the fields at once: title, a category (a pill you click to cycle between Note and List), an expiry (permanent, or auto-delete after an hour, a day, or a week), and the text, pre-filled from your selection if you had one. Fill it in and click Save task. Tasks are always private, unencrypted, and don't show up in cheat search.

### Work with your Brain

Brain is the AI-facing side of the same section: briefs are context you want an assistant to have, rules are constraints it should follow, and memories are what it records for itself. Three Command Palette commands cover it (no default keybindings, to avoid colliding with the chords above):

- `Cheatsheet Sidekick: Search Brain` searches those entries the same way Search Tasks does.
- `Cheatsheet Sidekick: Create Brain Entry` opens the same form with the category pill cycling Brief, Rules, and Memory instead of Note and List.
- `Cheatsheet Sidekick: Insert Guides (Brief + Rules)` pulls your briefs and rules as one formatted markdown block and inserts it at the cursor, which is the thing to drop into a `CLAUDE.md` or `AGENTS.md`. If you have none yet, it tells you so rather than inserting nothing.

## Plans and limits

This extension's usage aligns with whatever plan your Cheatsheet account is on. Search and insert work on any account for both cheats and Tasks, while creating either from VS Code needs a Pro plan (Pro also raises your daily API quota, and lifts the item caps on the site's own Vault, Tasks, Brain, Pennies, and Projects sections, which a free account can use up to 5 items each). See [Cheatsheet's plans](https://cheats.aarontrotter.com/billing) for the details.

A couple of other things worth knowing:

- Search only shows cheats you can normally see: your own private ones, plus everything public. Tasks are always private, so task search only ever shows your own.
- The daily API quota is shared across everything using your key, including Cheatsheet's Model Context Protocol integration if you use that too. Full API details live at [cheats.aarontrotter.com/api-docs](https://cheats.aarontrotter.com/api-docs).

## Contributing

Want to work on the extension itself rather than just use it? Clone [the repo](https://github.com/AaronTrotter/cheatsheet-vscode-extension), run `npm install`, then press F5 in VS Code to launch an Extension Development Host with your changes loaded (it builds automatically first). Use `npm run watch` while actively editing to recompile on save.