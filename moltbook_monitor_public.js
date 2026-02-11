#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ──────────────────────────────────────────────────
const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const STATE_FILE = path.join(__dirname, 'state.json');
const CREDS_FILE = path.join(os.homedir(), '.config/moltbook/credentials.json');
// you may want to use an environment variable here:
const SLACK_CHANNEL_ID = '<INSERT SLACK CHANNEL ID HERE>';
const OPENAI_MODEL = 'gpt-5-nano';
const POST_FETCH_LIMIT = 250;

// ── Credentials ─────────────────────────────────────────────
function loadCredentials() {
  const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
  if (!creds.api_key) throw new Error('Missing moltbook api_key in credentials');
  if (!creds.openai_api_key) throw new Error('Missing openai_api_key in credentials');
  return creds;
}

// ── State management ────────────────────────────────────────
function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { seenPostIds: [], lastCheck: null, digestCount: 0 };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── MoltBook API ────────────────────────────────────────────
async function fetchPosts(apiKey, limit) {
  console.log("limit: ", limit);
  const response = await fetch(
    `${MOLTBOOK_API}/posts?sort=new&limit=${limit}`,
    { headers: { 'Authorization': `Bearer ${apiKey}` } }
  );
  if (!response.ok) throw new Error(`MoltBook API error: ${response.status}`);
  const data = await response.json();
  return data.posts || [];
}

async function fetchHotPosts(apiKey, limit) {
  const response = await fetch(
    `${MOLTBOOK_API}/posts?sort=hot&limit=${limit}`,
    { headers: { 'Authorization': `Bearer ${apiKey}` } }
  );
  if (!response.ok) throw new Error(`MoltBook hot API error: ${response.status}`);
  const data = await response.json();
  return data.posts || [];
}

// ── OpenAI analysis ─────────────────────────────────────────
async function analyzeWithAI(openaiKey, posts) {
  // Build a compact summary of posts for the AI
  const postSummaries = posts.map((p, i) => {
    const score = (p.upvotes || 0) - (p.downvotes || 0);
    const commentCount = p.comment_count || 0;
    const author = p.author?.name || 'Unknown';
    const submolt = p.submolt?.name || 'general';
    return `[${i + 1}] "${p.title}" by ${author} in m/${submolt} | score:${score} comments:${commentCount}\n${(p.content || '').substring(0, 200)}`;
  }).join('\n\n');

  // Use an LLM to help generate a good prompt here:
  const prompt = ``;

  const response = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are a concise analyst producing Slack-formatted digests. Use *bold* for emphasis, bullet points with -, and keep it readable.' },
        { role: 'user', content: prompt },
      ],
      temperature: 1,
      max_completion_tokens: 30000,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();

  // Debug: log the full response structure
  //console.log('OpenAI response keys:', Object.keys(data));
  //console.log('OpenAI raw response:', JSON.stringify(data, null, 2).substring(0, 2000));

  // Try multiple possible response formats
  const content = data.choices?.[0]?.message?.content  // standard chat completions
    || data.output?.[0]?.content?.[0]?.text            // responses API format
    || data.output?.text                                // simple output format
    || JSON.stringify(data);                            // fallback: dump raw response

  if (!content || content === 'null') {
    console.error('WARNING: Empty content from OpenAI. Full response:', JSON.stringify(data));
  }

  return content || '(No analysis returned - check logs)';
}

// ── Slack delivery ──────────────────────────────────────────
async function sendToSlack(channelId, message) {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    console.log('Sending digest to Slack...');
    await execFileAsync('openclaw', [
      'message', 'send',
      '--channel', 'slack',
      '--target', `channel:${channelId}`,
      '--message', message
    ]);
    console.log('Sent OK');
  } catch (error) {
    console.error('Failed to send to Slack:', error.message);
  }
}

// ── Main monitor ────────────────────────────────────────────
async function monitor() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Starting MoltBook digest...`);

  try {
    const creds = loadCredentials();
    const state = loadState();

    // Fetch both new and hot posts for better coverage
    console.log('Fetching posts from MoltBook...');
    const [newPosts, hotPosts] = await Promise.all([
      fetchPosts(creds.api_key, POST_FETCH_LIMIT),
      fetchHotPosts(creds.api_key, 50),
    ]);

    console.log('New posts:', newPosts.length);

    // Deduplicate (hot and new may overlap)
    const allPostsMap = new Map();
    [...newPosts, ...hotPosts].forEach(p => allPostsMap.set(p.id, p));
    const allPosts = Array.from(allPostsMap.values());

    console.log(`Fetched ${allPosts.length} unique posts (${newPosts.length} new, ${hotPosts.length} hot)`);

    // Filter out posts we've already analyzed
    const unseenPosts = allPosts.filter(p => !state.seenPostIds.includes(p.id));
    console.log(`${unseenPosts.length} unseen posts to analyze`);

    if (unseenPosts.length === 0) {
      console.log('No new posts since last check. Skipping digest.');
      state.lastCheck = timestamp;
      saveState(state);
      return;
    }

    // Send to OpenAI for analysis
    console.log('Analyzing posts with AI...');
    const digest = await analyzeWithAI(creds.openai_api_key, unseenPosts);
    console.log('Analysis complete');

    // Build the full Slack message
    state.digestCount = (state.digestCount || 0) + 1;
    const header = `🦞 *Moltbook Monitor Digest #${state.digestCount}*  |  ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}  |  ${unseenPosts.length} posts analyzed`;
    const footer = `_Next digest in ~3 hours. Monitoring ${allPostsMap.size} posts across MoltBook._`;
    const slackMessage = `${header}\n${'─'.repeat(40)}\n\n${digest}\n\n${'─'.repeat(40)}\n${footer}`;

    // Send to Slack
    await sendToSlack(SLACK_CHANNEL_ID, slackMessage);

    // Update state
    const newSeenIds = allPosts.map(p => p.id);
    state.seenPostIds = [...new Set([...state.seenPostIds, ...newSeenIds])];

    // Keep only last 500 IDs
    if (state.seenPostIds.length > 500) {
      state.seenPostIds = state.seenPostIds.slice(-500);
    }

    state.lastCheck = timestamp;
    saveState(state);

    console.log('Digest complete!');
  } catch (error) {
    console.error('Error during monitoring:', error);

    // Try to notify Slack about the error
    try {
      console.log(`🦞 *Moltbook Monitor Error*\nMonitor failed: ${error.message}\nCheck logs for details.`)

      // await sendToSlack(SLACK_CHANNEL_ID, `🦞 *Moltbook Monitor Error*\nMonitor failed: ${error.message}\nCheck logs for details.`);
    } catch (e) {
      // silently fail
    }

    process.exit(1);
  }
}

// Run
if (require.main === module) {
  monitor();
}
