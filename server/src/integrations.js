import { FalkorDB } from 'falkordb';
import OpenAI from 'openai';
import { TrueForge } from '@truefoundry/trueforge-sdk';

let graphClientPromise;

export function configStatus() {
  return {
    trueforge: Boolean(process.env.TRUEFORGE_BASE_URL),
    openai: Boolean(process.env.OPENAI_API_KEY),
    brightData: Boolean(process.env.BRIGHTDATA_API_KEY && process.env.BRIGHTDATA_FETCH_DATASET_ID),
    falkorDb: Boolean(process.env.FALKORDB_URL),
  };
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
  if (!process.env.BRIGHTDATA_API_KEY || !process.env.BRIGHTDATA_FETCH_DATASET_ID) {
    throw new Error('Configure BRIGHTDATA_API_KEY and BRIGHTDATA_FETCH_DATASET_ID before fetching public URLs.');
  }
  const endpoint = new URL('https://api.brightdata.com/datasets/v3/scrape');
  endpoint.searchParams.set('dataset_id', process.env.BRIGHTDATA_FETCH_DATASET_ID);
  endpoint.searchParams.set('format', 'json');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ url }]),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Bright Data request failed (${response.status}): ${body.slice(0, 300)}`);
  let payload;
  try { payload = JSON.parse(body); } catch { payload = body; }
  return { payload, text: extractText(payload), retrievedAt: new Date().toISOString() };
}

function extractText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('\n\n');
  if (!value || typeof value !== 'object') return '';
  const parts = [];
  for (const [key, item] of Object.entries(value)) {
    if (/^(content|text|markdown|description|title|main_content|article|body)$/i.test(key)) {
      const text = extractText(item);
      if (text) parts.push(text);
    }
  }
  return parts.length ? parts.join('\n\n') : Object.values(value).map(extractText).filter(Boolean).join('\n');
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
