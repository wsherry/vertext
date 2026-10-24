import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};
const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const labelStatus = { draft: 'Setup in progress', ready: 'Ready to publish', live: 'Live now', ended: 'Session ended' };

function Icon({ name, size = 18 }) {
  const paths = {
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z" /><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20M8 7h8M8 10h7" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-5 5" /></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" /><path d="m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    upload: <><path d="M12 16V4m0 0L8 8m4-4 4 4" /><path d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6" /><path d="M10 11v5m4-5v5" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    network: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="m8 7 8-1m-9 2 4 8m6-7-4 7"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function App() {
  const [data, setData] = useState({ talks: [], sources: [], reports: [], config: {}, minimumCohort: 5 });
  const [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState('workspace');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showNewTalk, setShowNewTalk] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialText, setMaterialText] = useState('');
  const [materialFile, setMaterialFile] = useState(null);
  const [graph, setGraph] = useState(null);

  const selected = data.talks.find((talk) => talk.id === selectedId) || data.talks[0] || null;
  const talkSources = selected ? data.sources.filter((source) => source.talkId === selected.id) : [];
  const report = selected ? data.reports.find((item) => item.talkId === selected.id) : null;

  async function refresh(preferredId) {
    const dashboard = await request('/api/dashboard');
    setData(dashboard);
    const nextId = preferredId || selectedId;
    if (dashboard.talks.some((talk) => talk.id === nextId)) setSelectedId(nextId);
    else if (dashboard.talks[0]) setSelectedId(dashboard.talks[0].id);
    else setSelectedId('');
    return dashboard;
  }
  useEffect(() => {
    refresh().catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!selected) { setGraph(null); return; }
    request(`/api/talks/${selected.id}/graph`).then(setGraph).catch(() => setGraph(null));
  }, [selected?.id, report?.generatedAt]);

  async function run(label, action, success) {
    setBusy(label); setError('');
    try { await action(); await refresh(selected?.id); if (success) setToast(success); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }

  async function createTalk(formData) {
    const talk = await request('/api/talks', json('POST', formData));
    await refresh(talk.id); setShowNewTalk(false); setToast('Talk workspace created. Add and approve its sources to continue.');
  }

  async function addUrls(event) {
    event.preventDefault();
    const urls = urlInput.split(/\s+/).map((url) => url.trim()).filter(Boolean);
    await run('add-url', async () => {
      await request(`/api/talks/${selected.id}/sources/url`, json('POST', { urls }));
      setUrlInput('');
    }, 'Links added. Fetch each page, then review and approve its content.');
  }

  async function addMaterial(event) {
    event.preventDefault();
    if (!materialFile && !materialText.trim()) return setError('Add text or choose a file to continue.');
    const body = new FormData();
    body.append('title', materialTitle || materialFile?.name || 'Speaker notes');
    body.append('text', materialText);
    if (materialFile) body.append('file', materialFile);
    await run('add-material', async () => {
      await request(`/api/talks/${selected.id}/sources/material`, { method: 'POST', body });
      setMaterialTitle(''); setMaterialText(''); setMaterialFile(null);
      const input = document.querySelector('#speaker-file'); if (input) input.value = '';
    }, 'Private material added for speaker review.');
  }

  async function sourceAction(source, action) {
    await run(`${action}-${source.id}`, async () => {
      if (action === 'fetch') await request(`/api/sources/${source.id}/fetch`, json('POST', {}));
      if (action === 'approve') await request(`/api/sources/${source.id}/approve`, json('POST', { approved: true }));
      if (action === 'reject') await request(`/api/sources/${source.id}/approve`, json('POST', { approved: false }));
      if (action === 'delete') await request(`/api/sources/${source.id}`, { method: 'DELETE' });
    }, action === 'approve' ? 'Source approved for this talk.' : 'Source updated.');
  }

  if (loading) return <div className="loading-screen"><div className="brand-mark">t</div><span>Opening your speaker workspace</span></div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">v</div><div><b>vertext</b><span>speaker workspace</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <button className={`nav-item ${view === 'workspace' ? 'active' : ''}`} onClick={() => setView('workspace')}><Icon name="book" />Talk setup <span className="nav-count">{data.talks.length}</span></button>
      <button className={`nav-item ${view === 'insights' ? 'active' : ''}`} onClick={() => setView('insights')}><Icon name="chart" />Speaker insights</button>
      <div className="side-rule" />
      <div className="workspace-label">PILOT TALKS <button className="inline-icon" aria-label="Add talk" onClick={() => setShowNewTalk(true)}><Icon name="plus" size={15}/></button></div>
      <div className="talk-switcher">
        {data.talks.map((talk) => <button className={`talk-switch ${talk.id === selected?.id ? 'selected' : ''}`} key={talk.id} onClick={() => { setSelectedId(talk.id); setView('workspace'); }}>
          <span className={`talk-dot ${talk.status}`} />
          <span className="talk-switch-copy"><b>{talk.title}</b><small>{talk.speakerName}</small></span>
          <Icon name="chevron" size={15}/>
        </button>)}
        {!data.talks.length && <p className="sidebar-empty">Your selected talks will show here.</p>}
      </div>
      <div className="sidebar-bottom">
        <div className="pilot-card"><span className="eyebrow">PILOT MODE</span><p>Built for one or two talks. Sources are reviewed before they reach the live agent.</p></div>
        <div className="profile-row"><div className="avatar">SP</div><div><b>Speaker pilot</b><small>Local workspace</small></div><span className="status-led" /></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs">Conference pilot <span>/</span> {selected?.conference || 'Speaker workspace'}</div><div className="topbar-right"><span className="local-chip"><span />Private local workspace</span><button className="avatar small-avatar" title="Workspace">SP</button></div></header>
      <div className="page-content">
        <div className="page-heading">
          <div><div className="eyebrow accent-eyebrow">SPEAKER SIDE · PILOT</div><h1>{view === 'insights' ? 'Talk insights' : 'Speaker workspace'}</h1><p>{view === 'insights' ? 'See what attendees needed more context on after your talk.' : 'Prepare a trusted assistant for your talk, then learn what attendees wanted to understand.'}</p></div>
          <button className="button secondary" onClick={() => setShowNewTalk(true)}><Icon name="plus" size={17}/> Add talk</button>
        </div>
        <IntegrationBar config={data.config} />
        {error && <div className="alert error-alert"><span>{error}</span><button onClick={() => setError('')}><Icon name="close" size={16}/></button></div>}
        {!selected ? <EmptyState onCreate={() => setShowNewTalk(true)} /> : view === 'insights' ? <InsightsView talk={selected} report={report} graph={graph} min={data.minimumCohort} onGenerate={() => run('report', async () => request(`/api/talks/${selected.id}/report`, json('POST', {})), 'Report updated.')} busy={busy === 'report'} /> : <>
          <TalkOverview talk={selected} sourceCount={talkSources.length} approvedCount={talkSources.filter((s) => s.status === 'approved').length} activityCount={selected.activityCount} report={report} onEdit={() => setShowNewTalk('edit')} />
          <div className="section-label-row"><div><div className="eyebrow">PREPARE YOUR AGENT</div><h2>Talk source library</h2></div><span className="muted-count">{talkSources.length} {talkSources.length === 1 ? 'source' : 'sources'}</span></div>
          <div className="source-layout">
            <section className="panel source-panel">
              <div className="panel-heading"><div className="source-heading-icon"><Icon name="link"/></div><div><h3>Conference and public links</h3><p>Fetch with Bright Data, then review the captured content.</p></div></div>
              <form className="url-form" onSubmit={addUrls}><label htmlFor="source-url">Add one or more URLs</label><div className="input-action"><input id="source-url" placeholder="https://conference.org/talk/…" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} /><button className="button dark" type="submit" disabled={busy === 'add-url' || !urlInput.trim()}>{busy === 'add-url' ? 'Adding…' : 'Add links'}</button></div><small>Use public pages you have permission to include. Max 10 per submission.</small></form>
              <SourceList sources={talkSources.filter((s) => s.kind === 'public_url')} busy={busy} onAction={sourceAction} />
            </section>
            <section className="panel material-panel">
              <div className="panel-heading"><div className="source-heading-icon lavender"><Icon name="upload"/></div><div><h3>Private speaker materials</h3><p>Only used for this talk after you approve them.</p></div></div>
              <form className="material-form" onSubmit={addMaterial}>
                <label htmlFor="material-title">Material title</label><input id="material-title" placeholder="e.g. Slide notes, reading list" value={materialTitle} onChange={(e) => setMaterialTitle(e.target.value)} />
                <label htmlFor="speaker-file">Upload file <span className="optional">optional</span></label><input id="speaker-file" className="file-input" type="file" accept=".pdf,.docx,.pptx,.txt,.md" onChange={(e) => setMaterialFile(e.target.files?.[0] || null)} /><small className="field-hint">PDF, Word, PowerPoint, TXT, or Markdown · up to 12 MB</small>
                <label htmlFor="material-text">Or paste text</label><textarea id="material-text" placeholder="Add your talk notes, key concepts, or speaker-provided context…" rows="3" value={materialText} onChange={(e) => setMaterialText(e.target.value)} />
                <button className="button secondary full-button" type="submit" disabled={busy === 'add-material'}><Icon name="plus" size={16}/>{busy === 'add-material' ? 'Adding…' : 'Add private material'}</button>
              </form>
              <SourceList sources={talkSources.filter((s) => s.kind === 'speaker_material')} busy={busy} onAction={sourceAction} />
            </section>
          </div>
        <AgentReadiness talk={selected} sources={talkSources} busy={busy} trueforgeReady={Boolean(data.config.trueforge && data.config.trueforgeModelAvailable)} trueforgeConnected={Boolean(data.config.trueforgeConnected)} trueforgeModelConfigured={Boolean(data.config.trueforgeModelConfigured)} trueforgeModelAvailable={Boolean(data.config.trueforgeModelAvailable)} trueforgeModel={data.config.trueforgeModel} trueforgeAvailableModels={data.config.trueforgeAvailableModels || []} trueforgeAuthRequired={Boolean(data.config.trueforgeAuthRequired)} onPrepare={() => run('agent', async () => request(`/api/talks/${selected.id}/agent`, json('POST', {})), 'TrueForge agent is ready for your review.')} onPublish={() => run('publish', async () => request(`/api/talks/${selected.id}/publish`, json('POST', {})), 'Your session is live.')} onEnd={() => run('end', async () => request(`/api/talks/${selected.id}/end`, json('POST', {})), 'Session ended. You can generate your insights report.')} />
          <PrivacyNote minimum={data.minimumCohort} activityCount={selected.activityCount} />
          <InsightsView compact talk={selected} report={report} graph={graph} min={data.minimumCohort} onGenerate={() => run('report', async () => request(`/api/talks/${selected.id}/report`, json('POST', {})), 'Report updated.')} busy={busy === 'report'} />
        </>}
      </div>
    </main>
    {showNewTalk && <TalkModal initial={showNewTalk === 'edit' ? selected : null} onClose={() => setShowNewTalk(false)} onSave={async (values) => {
      if (showNewTalk === 'edit') await run('edit-talk', async () => request(`/api/talks/${selected.id}`, json('PATCH', values)), 'Talk details saved.');
      else await createTalk(values);
      setShowNewTalk(false);
    }} />}
    {toast && <div className="toast"><span className="toast-check"><Icon name="check" size={15}/></span>{toast}</div>}
  </div>;
}

function EmptyState({ onCreate }) {
  return <div className="empty-card"><div className="empty-illustration"><div className="empty-orbit orbit-one"/><div className="empty-orbit orbit-two"/><div className="empty-center"><Icon name="spark" size={27}/></div><span className="orbit-node n1"/><span className="orbit-node n2"/><span className="orbit-node n3"/></div><span className="eyebrow">START WITH ONE TALK</span><h2>Your speaker pilot starts here</h2><p>Create a talk workspace, add conference links or private material, and review the agent before sharing it with attendees.</p><button className="button dark" onClick={onCreate}><Icon name="plus" size={17}/> Create your first talk</button><div className="empty-footnote"><Icon name="clock" size={15}/> Setup usually takes a few minutes</div></div>;
}

function TalkOverview({ talk, sourceCount, approvedCount, activityCount, report, onEdit }) {
  const next = talk.status === 'draft' ? 'Add and approve sources, then prepare the agent.' : talk.status === 'ready' ? 'Your agent is ready. Publish when the talk is about to begin.' : talk.status === 'live' ? 'Attendees can use the talk companion now.' : report ? 'Your post-talk report is ready to review.' : 'Generate an aggregate report when you are ready.';
  return <section className="talk-overview">
    <div className="talk-overview-main"><div className="talk-overview-meta"><span className={`status-pill ${talk.status}`}><span className="talk-dot"/>{labelStatus[talk.status]}</span><span className="meta-separator">·</span><span>{talk.conference || 'Conference not set'}</span></div><h2>{talk.title}</h2><div className="speaker-line"><div className="avatar speaker-avatar">{talk.speakerName.split(/\s+/).map((p) => p[0]).slice(0,2).join('').toUpperCase()}</div><div><b>{talk.speakerName}</b><small>{talk.startsAt ? new Date(talk.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Talk time not set'}</small></div><button className="text-action" onClick={onEdit}>Edit details</button></div><div className="next-step"><span className="next-icon"><Icon name={talk.status === 'live' ? 'spark' : 'arrow'} size={16}/></span><span>{next}</span></div></div>
    <div className="overview-metrics"><div className="metric"><span>APPROVED SOURCES</span><b>{approvedCount}<small> / {sourceCount}</small></b><div className="metric-bar"><i style={{ width: `${sourceCount ? approvedCount / sourceCount * 100 : 0}%` }}/></div></div><div className="metric"><span>ATTENDEE QUESTIONS</span><b>{activityCount < 5 ? '—' : activityCount}</b><small className="privacy-small">Private until report threshold</small></div><div className="metric"><span>AGENT</span><b className="agent-metric">{talk.trueforgeAgentId ? <><span className="status-led green"/>Prepared</> : <><span className="status-led gray"/>Not ready</>}</b><small className="privacy-small">Powered by TrueForge</small></div></div>
  </section>;
}

function SourceList({ sources, busy, onAction }) {
  if (!sources.length) return <div className="source-empty"><span className="source-empty-icon"><Icon name="book" size={17}/></span><div><b>No materials added yet</b><small>Approved material will ground the talk agent.</small></div></div>;
  return <div className="source-list">{sources.map((source) => <div className="source-entry" key={source.id}><div className="source-row"><div className={`file-type ${source.kind === 'public_url' ? 'web-type' : 'doc-type'}`}><Icon name={source.kind === 'public_url' ? 'link' : 'book'} size={16}/></div><div className="source-info"><b>{source.title}</b><small>{source.kind === 'public_url' ? new URL(source.url).hostname : source.fileName || 'Speaker-provided text'}{source.retrievedAt ? ` · ${new Date(source.retrievedAt).toLocaleDateString()}` : ''}</small></div><span className={`source-status ${source.status}`}>{source.status === 'approved' ? 'Approved' : source.status === 'rejected' ? 'Excluded' : source.hasText ? 'Needs review' : 'Not fetched'}</span>
    <div className="source-actions">{source.kind === 'public_url' && !source.hasText && <button className="small-action" disabled={busy === `fetch-${source.id}`} onClick={() => onAction(source,'fetch')}>{busy === `fetch-${source.id}` ? 'Fetching…' : 'Fetch'}</button>}{source.hasText && ['pending','rejected'].includes(source.status) && <button className="small-action approve-action" disabled={busy === `approve-${source.id}`} onClick={() => onAction(source,'approve')}>{source.status === 'rejected' ? 'Include source' : 'Approve source'}</button>}{source.status === 'approved' && <button className="small-action" disabled={busy === `reject-${source.id}`} onClick={() => onAction(source,'reject')}>Remove approval</button>}<button className="icon-action danger-hover" title="Delete source" disabled={busy === `delete-${source.id}`} onClick={() => onAction(source,'delete')}><Icon name="trash" size={15}/></button></div>
  </div>{source.hasText && <details className="source-preview"><summary>Review captured content <span>{source.characterCount.toLocaleString()} characters</span></summary><p>{source.textPreview}{source.characterCount > source.textPreview.length ? ' …' : ''}</p></details>}</div>)}</div>;
}

function IntegrationBar({ config = {} }) {
  const items = [
    ['TrueForge', config.trueforge], ['OpenAI', config.openai], ['Bright Data', config.brightData], ['FalkorDB', config.falkorDb],
  ];
  return <div className="integration-bar"><div className="integration-label"><span className="eyebrow">INTEGRATIONS</span><small>Configured from .env</small></div><div className="integration-list">{items.map(([name, ready]) => <span className={`integration-item ${ready ? 'configured' : ''}`} key={name}><i/>{name}<small>{ready ? 'Ready' : 'Needs setup'}</small></span>)}</div></div>;
}

function AgentReadiness({ talk, sources, busy, trueforgeReady, trueforgeConnected, trueforgeModelConfigured, trueforgeModelAvailable, trueforgeModel, trueforgeAvailableModels, trueforgeAuthRequired, onPrepare, onPublish, onEnd }) {
  const approvedCount = sources.filter((s) => s.status === 'approved').length;
  const steps = [
    { n: '01', title: 'Add talk context', detail: 'Conference details and source links', done: true },
    { n: '02', title: 'Review source material', detail: `${approvedCount} source${approvedCount === 1 ? '' : 's'} approved`, done: approvedCount > 0 },
    { n: '03', title: 'Prepare the talk agent', detail: 'Grounded in your approved materials', done: Boolean(talk.trueforgeAgentId) },
  ];
  return <section className="panel readiness-panel"><div className="readiness-left"><div className="eyebrow">SESSION READINESS</div><h3>Review before attendees arrive</h3><p>Only approved materials are included in the TrueForge agent. You can keep adding sources until the session goes live.</p><div className="readiness-steps">{steps.map((step) => <div className={`readiness-step ${step.done ? 'done' : ''}`} key={step.n}><span className="step-check">{step.done ? <Icon name="check" size={13}/> : step.n}</span><div><b>{step.title}</b><small>{step.detail}</small></div></div>)}</div></div>
    <div className="readiness-action">{talk.status === 'live' ? <><span className="live-card"><span className="pulse-dot"/>Session is live</span><a className="button secondary full-button attendee-link" href={`/attendee/${encodeURIComponent(talk.id)}?preview=1`} target="_blank" rel="noreferrer">Test agent · not counted<Icon name="arrow" size={16}/></a><a className="button secondary full-button attendee-link" href={`/attendee/${encodeURIComponent(talk.id)}`} target="_blank" rel="noreferrer">Open live attendee experience<Icon name="arrow" size={16}/></a><button className="button secondary full-button" onClick={onEnd} disabled={busy === 'end'}>{busy === 'end' ? 'Ending…' : 'End session'}</button></> : talk.status === 'ended' ? <div className="ended-callout"><Icon name="check" size={18}/><span>Session ended<br/><small>Ready for speaker insights</small></span></div> : talk.trueforgeAgentId ? <><div className="agent-ready"><span className="agent-ready-icon"><Icon name="spark" size={19}/></span><div><b>Agent prepared</b><small>{talk.trueforgeAgentName}</small></div></div><a className="button secondary full-button attendee-link" href={`/attendee/${encodeURIComponent(talk.id)}?preview=1`} target="_blank" rel="noreferrer">Test attendee experience<Icon name="arrow" size={16}/></a><button className="button dark full-button" onClick={onPublish} disabled={busy === 'publish'}>{busy === 'publish' ? 'Publishing…' : 'Publish session'}<Icon name="arrow" size={16}/></button><small className="action-caption">Test mode questions are not counted in attendee insights.</small></> : <><button className="button dark full-button" onClick={onPrepare} disabled={busy === 'agent' || approvedCount === 0 || !trueforgeReady}>{busy === 'agent' ? <><span className="spinner"/>Preparing…</> : <>Prepare agent<Icon name="arrow" size={16}/></>}</button><small className="action-caption">{!trueforgeConnected ? 'TrueForge is offline. Start it to prepare this agent.' : trueforgeAuthRequired ? 'TrueForge needs a token. Set TRUEFORGE_TOKEN to continue.' : !trueforgeModelConfigured ? 'Add a model provider in TrueForge → Settings → Models.' : !trueforgeModelAvailable ? `TRUEFORGE_MODEL (“${trueforgeModel || 'unset'}”) is not enabled. Choose one of: ${trueforgeAvailableModels.join(', ')}.` : approvedCount ? `${approvedCount} approved source${approvedCount===1?'':'s'} will be included.` : 'Approve at least one source to continue.'}</small></>}</div>
  </section>;
}

function PrivacyNote({ minimum, activityCount }) {
  return <div className="privacy-strip"><span className="privacy-icon"><Icon name="check" size={16}/></span><div><b>Private, aggregate speaker feedback</b><p>Raw questions are used to find recurring themes, then deleted when a report is generated. Topic-level details stay hidden until at least {minimum} consented questions support a theme{activityCount > 0 ? ` · ${activityCount < minimum ? 'not enough activity yet' : 'report threshold reached'}` : ''}.</p></div><span className="privacy-badge">PRIVACY FIRST</span></div>;
}

function InsightsView({ talk, report, graph, min, onGenerate, busy, compact = false }) {
  const [graphOpen, setGraphOpen] = useState(false);
  if (compact && !report && talk.status !== 'ended') return <section className="insights-teaser"><div className="teaser-icon"><Icon name="chart" size={19}/></div><div><div className="eyebrow">AFTER THE TALK</div><h3>See what your audience wanted to know</h3><p>After you end the session, generate a private report of recurring needs and unanswered questions.</p></div><span className="teaser-lock"><Icon name="clock" size={16}/></span></section>;
  return <section className={`panel insights-panel ${compact ? 'compact-insights' : ''}`}><div className="insights-head"><div className="insights-title"><div className="insights-icon"><Icon name="chart" size={19}/></div><div><div className="eyebrow">POST-TALK FEEDBACK</div><h3>Attendee information needs</h3></div></div><div className="insight-tools">{report && !report.limitedData && <button className="button secondary small-button" onClick={() => setGraphOpen(!graphOpen)}><Icon name="network" size={15}/>{graphOpen ? 'Hide network' : 'View network'}</button>}{talk.status !== 'live' && <button className="button dark small-button" onClick={onGenerate} disabled={busy}>{busy ? <><span className="spinner"/>Generating…</> : <><Icon name="spark" size={15}/>{report ? 'Refresh report' : 'Generate report'}</>}</button>}</div></div>
    {!report ? <div className="report-empty"><div className="report-empty-graphic"><Icon name="chart" size={24}/></div><div><b>{talk.status === 'live' ? 'Your session is underway' : talk.status === 'ended' ? 'Your report is ready to generate' : 'No report yet'}</b><p>{talk.status === 'live' ? 'End the session before generating speaker insights.' : `The report combines consented questions into broad themes. Topic details need at least ${min} supporting questions.`}</p></div></div> : report.limitedData ? <div className="limited-report"><span className="limited-icon"><Icon name="clock" size={19}/></span><div><b>Limited activity report</b><p>{report.message}</p></div></div> : <>
      <div className="report-summary"><span className="summary-line"/><div><div className="eyebrow">OVERVIEW</div><p>{report.summary}</p><small>Generated {new Date(report.generatedAt).toLocaleString()}</small></div></div>
      {graphOpen && <div className="network-section"><div className="network-copy"><div><b>How the needs connect</b><small>{graph?.graphConnected ? 'FalkorDB network synced' : 'Network preview · FalkorDB is not connected'}</small></div><div className="legend"><span><i className="legend-talk"/>Talk</span><span><i className="legend-source"/>Source</span><span><i className="legend-need"/>Information need</span></div></div><InformationGraph graph={graph}/></div>}
      <div className="theme-grid">{report.themes.map((theme, index) => <article className="theme-card" key={`${theme.label}-${index}`}><div className="theme-card-top"><span className={`theme-number t${index % 4}`}>0{index + 1}</span><span className="theme-count">{theme.count} questions</span></div><h4>{theme.label}</h4><p>{theme.insight}</p><div className="suggested-action"><span>TRY</span>{theme.suggested_action}</div></article>)}</div>
      {report.unanswered?.length > 0 && <div className="unanswered-block"><div className="eyebrow">AREAS THAT STILL NEED CONTEXT</div>{report.unanswered.map((item, i) => <div className="unanswered-row" key={i}><span>↗</span>{item}</div>)}</div>}
      {report.sourceInterests?.length > 0 && <div className="source-interest"><span className="source-heading-icon"><Icon name="book" size={17}/></span><div><b>Resource interests</b><small>{report.sourceInterests.join(' · ')}</small></div></div>}
    </>}
  </section>;
}

function InformationGraph({ graph }) {
  const nodes = graph?.nodes || [];
  if (!nodes.length) return <div className="graph-empty">Network appears when approved sources or report themes are available.</div>;
  const width = 700, height = 260;
  const center = { x: 350, y: 128 };
  const edges = graph.links || [];
  const outer = nodes.filter((node) => node.type !== 'talk');
  const positioned = new Map([[nodes[0].id, center]]);
  outer.forEach((node, i) => {
    const angle = -Math.PI / 2 + i * (2 * Math.PI / Math.max(outer.length, 1));
    positioned.set(node.id, { x: center.x + Math.cos(angle) * 228, y: center.y + Math.sin(angle) * 85 });
  });
  return <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Information network showing the talk connected to approved sources and attendee themes">
    {edges.map((edge, i) => { const a = positioned.get(edge.source), b = positioned.get(edge.target); return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="graph-edge"/> : null; })}
    {nodes.map((node) => { const pos = positioned.get(node.id); const r = node.type === 'talk' ? 34 : node.type === 'need' ? 23 : 18; return <g key={node.id} transform={`translate(${pos.x} ${pos.y})`}><circle r={r} className={`graph-node ${node.type}`}/>{node.type === 'talk' && <text textAnchor="middle" dy="4" className="graph-talk-label">Talk</text>}<text textAnchor="middle" y={r + 16} className="graph-label">{node.label.length > 28 ? `${node.label.slice(0, 26)}…` : node.label}</text></g>; })}
  </svg>;
}

function TalkModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({ speakerName: initial?.speakerName || '', speakerEmail: initial?.speakerEmail || '', conference: initial?.conference || '', title: initial?.title || '', description: initial?.description || '', conferenceUrl: initial?.conferenceUrl || '', startsAt: initial?.startsAt || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  function change(event) { setForm((old) => ({ ...old, [event.target.name]: event.target.value })); }
  async function submit(event) { event.preventDefault(); setSaving(true); setError(''); try { await onSave(form); } catch (err) { setError(err.message); } finally { setSaving(false); } }
  return <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="talk-modal-title"><div className="modal-head"><div><div className="eyebrow">PILOT TALK</div><h2 id="talk-modal-title">{initial ? 'Edit talk details' : 'Create a talk workspace'}</h2><p>Start with the details attendees and the agent need.</p></div><button className="icon-action" onClick={onClose} aria-label="Close"><Icon name="close"/></button></div><form onSubmit={submit} className="modal-form"><div className="form-grid"><label>Speaker name<input name="speakerName" value={form.speakerName} onChange={change} required placeholder="e.g. Alex Morgan" /></label><label>Speaker email <span className="optional">optional</span><input name="speakerEmail" type="email" value={form.speakerEmail} onChange={change} placeholder="alex@example.com" /></label><label className="wide">Talk title<input name="title" value={form.title} onChange={change} required placeholder="The session title" /></label><label>Conference<input name="conference" value={form.conference} onChange={change} placeholder="Conference name" /></label><label>Start time <span className="optional">optional</span><input name="startsAt" type="datetime-local" value={form.startsAt} onChange={change} /></label><label className="wide">Conference talk link <span className="optional">optional</span><input name="conferenceUrl" type="url" value={form.conferenceUrl} onChange={change} placeholder="https://…" /></label><label className="wide">Talk description <span className="optional">optional</span><textarea name="description" rows="3" value={form.description} onChange={change} placeholder="What is this talk about?" /></label></div>{error && <div className="modal-error">{error}</div>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button dark" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save details' : 'Create workspace'}<Icon name="arrow" size={16}/></button></div></form></div></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
