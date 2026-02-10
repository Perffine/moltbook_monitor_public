# MoltBook Monitor

A Node.js tool that monitors [MoltBook](https://www.moltbook.com) (a social network for AI agents), generates AI-powered digests analyzing community trends, and posts them to Slack.

## What It Does

MoltBook Monitor fetches recent posts from MoltBook, sends them to an LLM for analysis, and delivers a structured digest to your Slack channel. Each digest includes:

- **Emerging Culture** - Signs of shared language, recurring themes, in-jokes, and community identity forming
- **Trending & Novel Threads** - High-engagement posts and topics generating real discussion
- **Promo Ratio** - Percentage of promotional vs genuine community content
- **Post of the Moment** - A post that captures the current state of the AI agent community

The monitor tracks which posts it has already analyzed to avoid duplicates across runs.

## Prerequisites

- Node.js 18+
- [OpenClaw CLI](https://openclaw.dev) configured for Slack messaging
- MoltBook API key
- OpenAI API key

## Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/Perffine/moltbook_monitor_public
   cd moltbook-monitor
   ```

2. Create a credentials file at `~/.config/moltbook/credentials.json`:
   ```json
   {
     "api_key": "your-moltbook-api-key",
     "openai_api_key": "your-openai-api-key"
   }
   ```

3. Edit `moltbook_monitor_public.js` and set your Slack channel ID:
   ```javascript
   const SLACK_CHANNEL_ID = '<SLACK CHANNEL ID>';
   ```

## Usage

Run manually:
```bash
node moltbook_monitor_public.js
```

Or set up a cron job to run periodically (e.g., every 3 hours):
```bash
0 */3 * * * /usr/bin/node /path/to/moltbook_monitor_public.js >> /var/log/moltbook-monitor.log 2>&1
```

## Configuration

Edit the constants at the top of `moltbook_monitor_public.js`:

| Constant | Default | Description |
|----------|---------|-------------|
| `SLACK_CHANNEL_ID` | (required) | Your Slack channel ID |
| `OPENAI_MODEL` | `gpt-5-nano` | OpenAI model to use for analysis |
| `POST_FETCH_LIMIT` | `250` | Number of new posts to fetch per run |

## State

The monitor maintains state in `state.json` in the script directory:
- `seenPostIds` - Post IDs already analyzed (keeps last 500)
- `lastCheck` - Timestamp of last run
- `digestCount` - Running count of digests sent

Delete `state.json` to reset and re-analyze all posts.

## License

MIT License - see [LICENSE](LICENSE) for details.
