# telegram-bulk-downloader

A command-line tool for bulk-downloading media from Telegram chats, channels, and groups.

This repository is a maintained derivative of the original
[JMax45/telegram-bulk-downloader](https://github.com/JMax45/telegram-bulk-downloader),
with additional features for more practical archival workflows.

## What's Different In This Repository

- Start downloading from a specific date instead of scanning from the beginning.
- Include media from Telegram comments and reply threads when the API supports it.
- Save files with more useful names that include message time, album grouping, and thread context.
- Keep optional `metadata.json` export for message-level inspection.

## Supported Media Types

- Photos
- Videos
- Documents
- Music
- Voice messages
- GIFs

## Important Notes

- This tool uses a Telegram user session with `API_ID` and `API_HASH`.
- It does not use a Telegram bot token.
- Authentication data is stored locally by the app. Treat that local data as sensitive.
- Reply-thread scanning can be slower on large chats because the downloader has to inspect root messages and then fetch replies per thread.
- Comment and reply retrieval depends on the Telegram chat type and what the Telegram API exposes for that chat.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Build the project

```bash
npm run build
```

### 3. Run the interactive downloader

```bash
node build/bin.js
```

If you want to use the CLI command globally from this local checkout:

```bash
npm link
telegram-bulk-downloader
```

## First Run

On the first run, the tool will ask for:

- `API_ID`
- `API_HASH`
- your phone number
- the login code sent by Telegram
- your Telegram 2FA password, if enabled

After login, choose `Start new download` and follow the prompts.

## Example Workflow

1. Enter a target username or chat ID.
2. Choose whether to write `metadata.json`.
3. Choose whether to include comments and reply threads.
4. Choose whether to start from a specific date.
5. Select the media types to download.
6. Choose an output folder.
7. Review the download summary.
8. Confirm to start the download.

The downloader prints a summary before it writes files, so you can cancel if
the target, output folder, date range, or media types look wrong.

## Date Filtering

When you choose to start from a specific date, the downloader first resolves
that date to a Telegram message boundary and then paginates by message ID. This
is more reliable than using the date on every media search request.

Accepted date formats:

```text
2026-04-08
2026/04/08
2026-4-8
2026-04-08 12:30
2026-04-08 12:30:00
```

Dates are interpreted in your local timezone.

## Command-Line Output

The CLI is still fully terminal-based, but it now shows:

- a startup banner;
- a download summary before work begins;
- one section per media type;
- batch-level progress messages;
- per-file progress bars;
- warnings when a file or reply thread cannot be downloaded;
- a final summary with downloaded count, failed count, scanned messages, reply threads, and elapsed time.

## Resuming Downloads

If you interrupt a download with `Ctrl+C`, progress is saved. Choose
`Resume active download` the next time you start the tool.

The resume menu shows the chat, date range, remaining work, and output folder
for each active download.

## File Naming

Downloaded files are named to make grouping easier.

Single media message:

```text
2026-04-08_15-30-22__msg-1050.jpg
```

Telegram album or multi-photo post:

```text
2026-04-08_15-30-22__album-7348291029384__msg-1051.jpg
2026-04-08_15-30-22__album-7348291029384__msg-1052.jpg
2026-04-08_15-30-22__album-7348291029384__msg-1053.jpg
```

Reply-thread media:

```text
2026-04-08_15-31-10__thread-1050__reply-18.jpg
```

Files from the same Telegram album share the same `album-...` identifier.
Files from the same comment thread share the same `thread-...` identifier.

## Wipe Stored Data

If you want to remove stored authentication data:

```bash
telegram-bulk-downloader wipe
```

Only remove sensitive authentication data:

```bash
telegram-bulk-downloader wipe --soft
```

## Development

Build:

```bash
npm run build
```

Run the built CLI:

```bash
npm start
```

Link the local checkout as a global command:

```bash
npm link
```

After linking, rebuild after code changes:

```bash
npm run build
```

## Upstream Attribution

This repository started from the MIT-licensed project
[JMax45/telegram-bulk-downloader](https://github.com/JMax45/telegram-bulk-downloader).

Changes in this repository include:

- start-date filtering
- reply-thread media download support
- more descriptive file naming
- build and TypeScript maintenance updates

See [NOTICE.md](./NOTICE.md) for attribution details.

## License

This repository is distributed under the MIT License.

- Original license text: [LICENSE](./LICENSE)
- Attribution notes: [NOTICE.md](./NOTICE.md)
