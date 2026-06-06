import { useEffect, useState, useCallback } from 'react';

const api = (path, init = {}) =>
  fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  }).then(async r => {
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || r.statusText); }
    return r.json();
  });

function Alert({ msg, type = 'success', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return <div className={`alert alert-${type}`}>{msg}</div>;
}

function fmtDate(s) {
  if (!s) return '';
  return new Date(s + 'Z').toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Monitor tab ───────────────────────────────────────────────────────────────
function MonitorTab() {
  const [tasks, setTasks]   = useState([]);
  const [stats, setStats]   = useState(null);
  const [filter, setFilter] = useState('open'); // open | done | all
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      api('/api/tasks?status=' + (filter === 'all' ? 'open' : filter)).catch(() => []),
      api('/api/stats').catch(() => null),
    ]);
    setTasks(t || []);
    setStats(s);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const byAssignee = tasks.reduce((acc, t) => {
    const k = t.assigned_to || '⬜ Unassigned';
    (acc[k] = acc[k] || []).push(t);
    return acc;
  }, {});

  return (
    <div>
      {/* Stats strip */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <div className="stat-card">
            <span className="stat-num" style={{ color: 'var(--primary)' }}>{stats.open}</span>
            <span className="stat-label">Open</span>
          </div>
          <div className="stat-card">
            <span className="stat-num" style={{ color: 'var(--success)' }}>{stats.done}</span>
            <span className="stat-label">Done</span>
          </div>
          {(stats.open_by_assignee || []).filter(r => r.assigned_to).map(r => (
            <div className="stat-card" key={r.assigned_to}>
              <span className="stat-num">{r.cnt}</span>
              <span className="stat-label">{r.assigned_to}</span>
            </div>
          ))}
          {(stats.done_by_person || []).map(r => (
            <div className="stat-card" key={r.done_by} style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
              <span className="stat-num" style={{ color: 'var(--success)' }}>{r.cnt} ✅</span>
              <span className="stat-label">{r.done_by}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filter + refresh */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {['open', 'done'].map(f => (
          <button key={f} className={`btn ${filter === f ? 'btn-primary' : ''}`}
            onClick={() => setFilter(f)} style={{ textTransform: 'capitalize' }}>
            {f === 'open' ? '🔵 Open' : '✅ Done'}
          </button>
        ))}
        <button className="btn" onClick={load} style={{ marginLeft: 'auto' }}>↻</button>
        <span style={{ color: 'var(--text2)', fontSize: 12 }}>Auto-refreshes every 15s</span>
      </div>

      {loading ? <p className="muted">Loading…</p> :
        tasks.length === 0 ? <div className="empty">🎉 No tasks here.</div> :
        filter === 'open' ? (
          Object.entries(byAssignee).map(([person, group]) => (
            <div key={person} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <strong>{person}</strong>
                <span className="badge badge-open">{group.length}</span>
              </div>
              {group.map(t => (
                <div className="task-row" key={t.id}>
                  <span className="task-id">#{t.id}</span>
                  <span className="task-title">{t.title}</span>
                  <span className="task-date">{fmtDate(t.created_at)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text2)' }}>by {t.created_by}</span>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="card">
            {[...tasks].reverse().map(t => (
              <div className="task-row" key={t.id} style={{ opacity: 0.75 }}>
                <span className="task-id">#{t.id}</span>
                <span className="task-title" style={{ textDecoration: 'line-through' }}>{t.title}</span>
                <span className="task-date">{fmtDate(t.done_at)}</span>
                <span style={{ fontSize: 11, color: 'var(--success)' }}>✅ {t.done_by}</span>
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
}

// ── ListEditor ────────────────────────────────────────────────────────────────
function ListEditor({ label, items, onChange, placeholder, validate }) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (validate) { const msg = validate(v); if (msg) { setErr(msg); return; } }
    if (items.includes(v)) { setErr('Already in list'); return; }
    onChange([...items, v]); setDraft(''); setErr('');
  }

  return (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label className="label">{label}</label>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <span style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '7px 12px', fontSize: 13 }}>{item}</span>
          <button type="button" className="btn btn-danger" style={{ padding: '4px 10px' }}
            onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="form-row" style={{ margin: 0, marginTop: items.length ? 6 : 0 }}>
        <input className="input" placeholder={placeholder} value={draft}
          onChange={e => { setDraft(e.target.value); setErr(''); }}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())} />
        <button type="button" className="btn btn-primary" onClick={add} style={{ flexShrink: 0 }}>+ Add</button>
      </div>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────
function SettingsTab() {
  const [form, setForm] = useState({ bot_token: '', chat_ids: [], nudge_schedules: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(null);
  const [showToken, setShowToken] = useState(false);

  function notify(msg, type = 'success') { setFlash({ msg, type }); }

  useEffect(() => {
    api('/api/settings').then(d => { setForm(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify(form) });
      notify('Settings saved ✅ — restart bot to apply schedule changes');
    } catch (err) { notify(err.message, 'error'); }
    finally { setSaving(false); }
  }

  async function sendNudge() {
    try { await api('/api/nudge', { method: 'POST' }); notify('Nudge sent to all chats! 📣'); }
    catch (err) { notify(err.message, 'error'); }
  }

  function validateChatId(v) { if (!/^-?\d+$/.test(v)) return 'Must be a numeric ID'; }
  function validateTime(v) {
    if (!/^\d{1,2}:\d{2}$/.test(v)) return 'Use HH:MM (e.g. 08:00)';
    const [h, m] = v.split(':').map(Number);
    if (h > 23 || m > 59) return 'Invalid time';
  }

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div>
      {flash && <Alert msg={flash.msg} type={flash.type} onClose={() => setFlash(null)} />}
      <form onSubmit={save}>
        <div className="card">
          <h2>🤖 Bot Token</h2>
          <div className="form-group">
            <label className="label">Token (from @BotFather)</label>
            <div className="form-row" style={{ margin: 0 }}>
              <input className="input" type={showToken ? 'text' : 'password'}
                value={form.bot_token ?? ''} placeholder="123456:ABC…"
                onChange={e => setForm(f => ({ ...f, bot_token: e.target.value }))} />
              <button type="button" className="btn" onClick={() => setShowToken(v => !v)} style={{ flexShrink: 0 }}>
                {showToken ? '🙈' : '👁'}
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>👥 Allowed Chat IDs</h2>
          <p className="muted" style={{ marginBottom: 14 }}>
            Add your Telegram user ID and your wife's. Send <code>/chatid</code> to the bot in DM to get yours.
          </p>
          <ListEditor label="Chat IDs" items={form.chat_ids}
            onChange={ids => setForm(f => ({ ...f, chat_ids: ids }))}
            placeholder="e.g. 123456789" validate={validateChatId} />
        </div>

        <div className="card">
          <h2>⏰ Daily Nudge Schedules</h2>
          <p className="muted" style={{ marginBottom: 14 }}>
            Bot sends all open tasks at each time every day (to all allowed chats).
          </p>
          <ListEditor label="Nudge times" items={form.nudge_schedules}
            onChange={times => setForm(f => ({ ...f, nudge_schedules: times }))}
            placeholder="HH:MM e.g. 08:00" validate={validateTime} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : '💾 Save Settings'}
          </button>
          <button className="btn" type="button" onClick={sendNudge}>📣 Send Nudge Now</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>⚠️ Restart the bot after saving to apply schedule changes.</p>
      </form>
    </div>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('monitor');
  const [stats, setStats] = useState(null);

  useEffect(() => { api('/api/stats').then(setStats).catch(() => {}); }, []);

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>🤖 NudgeBot</h1>
          <p className="muted">Admin dashboard — use the bot for all task work</p>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: 10 }}>
            <span className="badge badge-open">{stats.open} open</span>
            <span className="badge badge-done">{stats.done} done</span>
          </div>
        )}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'monitor' ? 'active' : ''}`} onClick={() => setTab('monitor')}>📊 Monitor</button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>⚙️ Settings</button>
      </div>

      {tab === 'monitor'  && <MonitorTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}
