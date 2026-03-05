---
name: Slack
description: Read and write Slack messages, channels, threads, and reactions using direct API calls. All data stays on the user's machine — no third-party services, no proxies, no data leaves localhost except to Slack's official API (slack.com) over HTTPS.
---

# Slack Skill

Max can interact with Slack workspaces using direct `curl` calls to the Slack Web API. All communication goes directly from the user's machine to `https://slack.com/api/` over HTTPS — no intermediaries, no third-party services, no data stored beyond the conversation.

## Security Model

**This skill is designed to never let data leave the user's machine except to Slack's official API.**

1. **Token storage**: The Slack token lives in `~/.max/.env` as `SLACK_BOT_TOKEN` (and optionally `SLACK_USER_TOKEN`). This file should be `chmod 600`.
2. **Direct API calls only**: Every request is a `curl` to `https://slack.com/api/`. No proxies, no webhooks, no third-party endpoints.
3. **Never display or log the token**: When showing commands to the user, always reference `$SLACK_BOT_TOKEN` — never expand it. Never include the token value in worker session prompts, logs, or memory.
4. **No persistent caching**: Message content is never written to disk, databases, or memory storage. It exists only in the conversation context.
5. **Minimal scopes**: Guide the user to grant only the scopes they need (see Setup).

## Prerequisites

The user needs a Slack Bot Token (starts with `xoxb-`) or a User Token (starts with `xoxp-`).

**Bot tokens** are recommended for most operations. They're scoped, auditable, and can be revoked from the Slack admin panel without affecting the user's personal account.

**User tokens** are required for `search.messages` and a few admin operations. Use them only when a bot token can't do the job.

If neither token is configured, guide the user through setup.

## Setup

### Step 1: Create a Slack App

1. Go to https://api.slack.com/apps and click "Create New App" → "From scratch"
2. Name it (e.g., "Max Assistant") and select the workspace
3. Under **OAuth & Permissions**, add these Bot Token Scopes:

**Minimum scopes for reading:**
- `channels:history` — read messages in public channels
- `channels:read` — list and get info about public channels
- `groups:history` — read messages in private channels the bot is in
- `groups:read` — list private channels the bot is in
- `im:history` — read direct messages with the bot
- `users:read` — resolve user IDs to names

**Additional scopes for writing:**
- `chat:write` — send messages
- `reactions:read` — read reactions
- `reactions:write` — add reactions
- `files:read` — access shared files
- `files:write` — upload files

**If using a User Token** (for search):
- `search:read` — search messages and files

4. Click "Install to Workspace" and authorize
5. Copy the Bot Token (`xoxb-...`) from the OAuth page

### Step 2: Store the Token

Store the token in Max's environment file. **Never use `echo` with the raw token** — it would be saved in shell history.

```bash
# In a worker session — use ask_user to collect the token, then write it without exposing it:
# 1. Ask the user for their token via ask_user
# 2. Write it to the env file like this (TOKEN_VALUE comes from ask_user, not typed in a shell):
printf 'SLACK_BOT_TOKEN=%s\n' "$TOKEN_VALUE" >> ~/.max/.env
chmod 600 ~/.max/.env
```

If the user also needs search, do the same for the user token:
```bash
printf 'SLACK_USER_TOKEN=%s\n' "$TOKEN_VALUE" >> ~/.max/.env
```

**Preferred approach**: Use `ask_user` to collect the token value, then write it to `~/.max/.env` programmatically via `printf` and a variable — never embed the literal token in a shell command string.

**After adding the token, Max must restart to pick up the new env var.** Use the `restart_max` tool.

### Step 3: Verify

```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test | python3 -m json.tool
```

This should return `"ok": true` with the bot's user ID and team info.

### Step 4: Invite the Bot

The bot must be invited to channels it needs to access:
- In Slack, go to the channel → type `/invite @YourBotName`
- Or use the API: the bot can join public channels with `conversations.join`

## Important: Reading the Token

The token is stored in `~/.max/.env`. To use it in curl commands within a worker session, **source the env file first**:

```bash
source ~/.max/.env
```

Then use `$SLACK_BOT_TOKEN` or `$SLACK_USER_TOKEN` in subsequent commands. Do this once at the start of any worker session that needs Slack access.

## API Reference

All commands use this pattern:

```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/{method}?{params}" | python3 -m json.tool
```

For POST requests with a body:

```bash
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"C1234567890","text":"Hello"}' \
  https://slack.com/api/chat.postMessage | python3 -m json.tool
```

**Always pipe through `python3 -m json.tool`** for readable output. If the output is very large, pipe through `python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2)[:2000])"` to truncate.

### Verify Auth

```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  https://slack.com/api/auth.test | python3 -m json.tool
```

### List Channels

```bash
# Public channels (paginated — use cursor for next page)
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.list?types=public_channel&limit=100&exclude_archived=true" \
  | python3 -m json.tool

# Include private channels the bot is in
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=100" \
  | python3 -m json.tool

# Pagination: use response_metadata.next_cursor from the response
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.list?types=public_channel&limit=100&cursor=NEXT_CURSOR_VALUE" \
  | python3 -m json.tool
```

### Get Channel Info

```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.info?channel=C1234567890" \
  | python3 -m json.tool
```

### Read Messages (Channel History)

```bash
# Latest 20 messages in a channel
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.history?channel=C1234567890&limit=20" \
  | python3 -m json.tool

# Messages after a specific timestamp
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.history?channel=C1234567890&oldest=1700000000.000000&limit=50" \
  | python3 -m json.tool

# Messages before a specific timestamp
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.history?channel=C1234567890&latest=1700000000.000000&limit=50" \
  | python3 -m json.tool
```

**Timestamps** in Slack are Unix epoch with microseconds (e.g., `1700000000.000000`). Message `ts` values double as unique IDs.

### Read Thread Replies

```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.replies?channel=C1234567890&ts=1700000000.000000&limit=50" \
  | python3 -m json.tool
```

The `ts` parameter is the timestamp of the **parent message** (thread root).

### Send a Message

```bash
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"C1234567890","text":"Hello from Max!"}' \
  https://slack.com/api/chat.postMessage | python3 -m json.tool
```

### Reply to a Thread

```bash
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"C1234567890","thread_ts":"1700000000.000000","text":"Thread reply from Max"}' \
  https://slack.com/api/chat.postMessage | python3 -m json.tool
```

### Update a Message

```bash
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"C1234567890","ts":"1700000000.000000","text":"Updated message text"}' \
  https://slack.com/api/chat.update | python3 -m json.tool
```

### Delete a Message

```bash
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"C1234567890","ts":"1700000000.000000"}' \
  https://slack.com/api/chat.delete | python3 -m json.tool
```

### Add a Reaction

```bash
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"C1234567890","timestamp":"1700000000.000000","name":"thumbsup"}' \
  https://slack.com/api/reactions.add | python3 -m json.tool
```

Emoji names are without colons (e.g., `thumbsup` not `:thumbsup:`).

### Search Messages (requires User Token)

```bash
curl -s -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  "https://slack.com/api/search.messages?query=deployment%20failed&count=10" \
  | python3 -m json.tool
```

**Search requires a User Token** (`xoxp-`). Bot tokens cannot search. If the user hasn't configured `SLACK_USER_TOKEN`, tell them search requires it and guide them through adding the `search:read` scope to their app's User Token Scopes.

### Look Up Users

```bash
# List workspace members
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/users.list?limit=100" \
  | python3 -m json.tool

# Get a specific user's profile
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/users.info?user=U1234567890" \
  | python3 -m json.tool

# Look up user by email
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/users.lookupByEmail?email=user@example.com" \
  | python3 -m json.tool
```

### Upload a File

```bash
# Upload a file to a channel
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -F "channels=C1234567890" \
  -F "file=@/path/to/file.txt" \
  -F "title=My File" \
  -F "initial_comment=Here's the file you requested" \
  https://slack.com/api/files.upload | python3 -m json.tool
```

### Join a Public Channel

```bash
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"C1234567890"}' \
  https://slack.com/api/conversations.join | python3 -m json.tool
```

### Send a Direct Message

To DM a user, first open a DM channel, then send to it:

```bash
# Open a DM channel with a user
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"users":"U1234567890"}' \
  https://slack.com/api/conversations.open | python3 -m json.tool

# Then send to the returned channel ID
curl -s -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"D_RETURNED_ID","text":"Hey!"}' \
  https://slack.com/api/chat.postMessage | python3 -m json.tool
```

## Error Handling

**Check HTTP status first, then the JSON body.** Most successful Slack API responses return HTTP 200 with `"ok": true`, but errors can surface at either layer.

### HTTP-level errors

- **429 Too Many Requests**: Rate limited. Read the `Retry-After` header (seconds) and wait before retrying. Do NOT retry immediately.
- **5xx**: Slack server error. Wait a few seconds and retry once. If it persists, report the failure.
- **Non-200/non-429**: Network or transport failure. Check connectivity.

### JSON-level errors (HTTP 200, `"ok": false`)

Check the `"error"` field:

- `not_authed` / `invalid_auth` — token is missing or invalid. Verify with `auth.test`.
- `channel_not_found` — wrong channel ID or bot isn't in the channel. List channels to find the right ID.
- `not_in_channel` — bot needs to be invited. Use `/invite @BotName` in Slack or `conversations.join`.
- `missing_scope` — token lacks a required permission. Tell the user which scope to add at https://api.slack.com/apps.
- `ratelimited` — also returned as a JSON error sometimes. Check both the HTTP status and this field.
- `account_inactive` / `token_revoked` — token was revoked. User needs to reissue it.

## Rate Limiting

Slack enforces rate limits per method (typically 1-50+ requests per minute depending on the tier). If you get `ratelimited`:

1. Read the `Retry-After` response header (seconds to wait)
2. Wait that duration before retrying
3. Batch requests where possible (e.g., fetch 100 messages at once instead of 10×10)

## Tips

- **Channel IDs vs names**: Always use channel IDs (e.g., `C1234567890`), not `#channel-name`. Get IDs from `conversations.list`.
- **User IDs vs names**: Messages contain user IDs like `U1234567890`. Resolve to names with `users.info`.
- **Timestamps are IDs**: A message's `ts` field is both its timestamp and unique identifier. Use it for threading, updating, and deleting.
- **Pagination**: Most list endpoints return a `response_metadata.next_cursor`. Keep fetching with `&cursor=VALUE` until the cursor is empty.
- **Rich formatting**: Slack uses mrkdwn (their Markdown variant). `*bold*`, `_italic_`, `~strikethrough~`, `` `code` ``, `> quote`, `<https://url|link text>`.
- **Mentioning users**: Use `<@U1234567890>` in message text to @-mention someone.
- **Mentioning channels**: Use `<#C1234567890>` to link to a channel.
- **Large payloads**: For messages over 4000 chars, consider uploading as a snippet via `files.upload` instead.
