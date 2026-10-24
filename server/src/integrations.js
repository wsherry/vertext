import { FalkorDB } from 'falkordb';
import OpenAI from 'openai';
import { TrueForge } from '@truefoundry/trueforge-sdk';
import { chromium } from 'playwright-core';

let graphClientPromise;

export function configStatus() {
  return {
    trueforge: Boolean(process.env.TRUEFORGE_BASE_URL),
    openai: Boolean(process.env.OPENAI_API_KEY),
    brightData: Boolean(process.env.BRIGHTDATA_BROWSER_API_USERNAME && process.env.BRIGHTDATA_BROWSER_API_PASSWORD),
    falkorDb: Boolean(process.env.FALKORDB_URL),
  };
}

export async function trueforgeReadiness() {
  if (!process.env.TRUEFORGE_BASE_URL) return { connected: false, modelConfigured: false, authRequired: false };
  try {
    const healthUrl = new URL('/healthz', process.env.TRUEFORGE_BASE_URL);
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return { connected: false, modelConfigured: false, authRequired: false };
  } catch {
    return { connected: false, modelConfigured: false, authRequired: false };
  }
  try {
    const models = await trueforgeClient().models.list();
    const availableModels = Array.isArray(models.data)
      ? models.data.map((model) => typeof model === 'string' ? model : model?.name).filter(Boolean)
      : [];
    const model = (process.env.TRUEFORGE_MODEL || 'openai/gpt-5-4').trim();
    return {
      connected: true,
      modelConfigured: availableModels.length > 0,
      modelAvailable: availableModels.includes(model),
      model,
      availableModels,
      authRequired: false,
    };
  } catch (error) {
    const status = Number(error.statusCode || error.status);
    return { connected: true, modelConfigured: false, modelAvailable: false, authRequired: [401, 403].includes(status) };
  }
}

export async function integrationStatus() {
  const trueforge = await trueforgeReadiness();
  return { ...configStatus(), trueforge: trueforge.connected && trueforge.modelConfigured && trueforge.modelAvailable, ...{
    trueforgeConnected: trueforge.connected,
    trueforgeModelConfigured: trueforge.modelConfigured,
    trueforgeModelAvailable: trueforge.modelAvailable,
    trueforgeModel: trueforge.model,
    trueforgeAvailableModels: trueforge.availableModels,
    trueforgeAuthRequired: trueforge.authRequired,
  } };
}

export function trueforgeClient() {
  if (!process.env.TRUEFORGE_BASE_URL) throw new Error('Set TRUEFORGE_BASE_URL to connect TrueForge.');
  return new TrueForge({
    baseUrl: process.env.TRUEFORGE_BASE_URL,
    ...(process.env.TRUEFORGE_TOKEN ? { token: process.env.TRUEFORGE_TOKEN } : {}),
    timeoutInSeconds: 90,
  });
}

export async function scrapePublicUrl(url) {
  const username = process.env.BRIGHTDATA_BROWSER_API_USERNAME;
  const password = process.env.BRIGHTDATA_BROWSER_API_PASSWORD;
  if (!username || !password) {
    throw new Error('Configure the Bright Data Browser API zone username and password before fetching public URLs.');
  }
  const endpoint = new URL('wss://brd.superproxy.io:9222');
  endpoint.username = username;
  endpoint.password = password;
  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint.toString(), { timeout: 30_000 });
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const [title, text] = await Promise.all([page.title(), page.locator('body').innerText({ timeout: 15_000 })]);
    return { payload: { url, title }, text, retrievedAt: new Date().toISOString() };
  } catch (error) {
    const message = String(error?.message || '');
    if (/401|403|407|authentication|credentials/i.test(message)) {
      throw new Error('Bright Data Browser API authentication failed. Check the zone username and password.');
    }
    if (/timeout|timed out/i.test(message)) {
      throw new Error('Bright Data Browser API timed out while loading the public page. Try again.');
    }
    throw new Error('Bright Data Browser API could not load this public page. Check the zone configuration and try again.');
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function generateInsights({ talk, questions, minimum }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY to generate the speaker report.');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await openai.responses.create({
    model: process.env.OPENAI_REPORT_MODEL || 'gpt-4.1-mini',
    store: false,
    instructions: [
      'You prepare a private speaker feedback report from consented anonymous questions asked during one talk.',
      'Summarize recurring information needs and unresolved areas in plain language.',
      `Do not include a topic unless at least ${minimum} questions support it.`,
      'Do not quote questions verbatim, infer attendee identities or demographics, or judge the speaker.',
      'Return only a JSON object with keys: summary (string), themes (array of {label, count, insight, suggested_action}), unanswered (array of strings), source_interests (array of strings).',
      'Themes must use only the supplied topic groups and counts. Keep source_interests general.',
    ].join(' '),
    input: JSON.stringify({
      talk: { title: talk.title, description: talk.description },
      aggregatedTopicGroups: questions,
    }),
  });
  const text = result.output_text || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('OpenAI returned a report in an unexpected format.');
  return JSON.parse(text.slice(start, end + 1));
}

export async function syncTalkGraph({ talk, sources, report }) {
  if (!process.env.FALKORDB_URL) return { connected: false };
  try {
    graphClientPromise ??= FalkorDB.connect({ url: process.env.FALKORDB_URL });
    const db = await graphClientPromise;
    const graph = db.selectGraph(process.env.FALKORDB_GRAPH || 'conference_talk_companion');
    await graph.query(
      'MATCH (t:Talk {id: $id})-[r]->(n) DELETE r, n',
      { params: { id: talk.id } },
    );
    await graph.query(
      'MERGE (t:Talk {id: $id}) SET t.title = $title, t.speaker = $speaker',
      { params: { id: talk.id, title: talk.title, speaker: talk.speakerName } },
    );
    for (const source of sources.filter((item) => item.status === 'approved')) {
      await graph.query(
        'MATCH (t:Talk {id: $talkId}) MERGE (s:Source {id: $sourceId}) SET s.title = $title, s.url = $url, s.kind = $kind MERGE (t)-[:USES_SOURCE]->(s)',
        { params: { talkId: talk.id, sourceId: source.id, title: source.title, url: source.url || '', kind: source.kind } },
      );
    }
    for (const [index, theme] of (report?.themes || []).entries()) {
      const themeId = `${talk.id}_${index}`;
      await graph.query(
        'MATCH (t:Talk {id: $talkId}) MERGE (n:InformationNeed {id: $themeId}) SET n.label = $label, n.count = $count MERGE (t)-[:REVEALED_NEED]->(n)',
        { params: { talkId: talk.id, themeId, label: theme.label, count: theme.count } },
      );
    }
    return { connected: true };
  } catch (error) {
    console.warn(`FalkorDB sync skipped: ${error.message}`);
    return { connected: false, error: error.message };
  }
}
