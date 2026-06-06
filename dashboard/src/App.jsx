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

// ── Tasks tab ─────────────────────────────────────────────────────────────────
function TasksTab() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [assigned, setAssigned] = useState('');
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(() =>
    api('/api/tasks?status=' + (showDone ? 'done' : 'open')).then(setTasks).catch(() => {}),
    [showDone]);

  useEffect(() => { load(); }, [load]);

  function notify(msg, type = 'success') { setFlash({ msg, type }); }

  async function addTask(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: title.trim(), assigned_to: assigned.trim() }) });
      setTitle(''); setAssigned('');
      await load();
      notify('Task added ✅');
    } catch (err) { notify(err.message, 'error'); }
    finally { setAdding(false); }
  }

  async function completeTask(id) {
    try {
      await api(`/api/tasks/${id}/done`, { method: 'POST', body: JSON.stringify({ done_by: 'dashboard' }) });
      await load();
      notify('Marked done ✅');
    } catch (err) { notify(err.message, 'error'); }
  }

  async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    try {
      await api(`/api/tasks/${id}`, { method: 'DELETE' });
      await load();
      notify('Deleted 🗑');
    } catch (err) { notify(err.message, 'error'); }
  }

  function fmtDate(s) {
    if (!s) return '';
    return new Date(s + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const open = tasks.filter(t => t.status === 'open');
  const done = tasks.filter(t => t.status === 'done');

  return (
    <div>
      {flash && <Alert msg={flash.msg} type={flash.type} onClose={() => setFlash(null)} />}

      {/* Add task */}
      <div className="card">
        <h2>Add Task</h2>
        <form onSubmit={addTask}>
          <div className="form-row">
            <input className="input" placeholder="Task description…" value={title} onChange={e => setTitle(e.target.value)} required />
            <input className="input" placeholder="Assign to (optional)" value={assigned} onChange={e => setAssigned(e.target.value)} style={{ maxWidth: 180 }} />
            <button className="btn btn-primary" disabled={adding}>{adding ? 'Adding…' : '+ Add'}</button>
          </div>
        </form>
      </div>

      {/* Open tasks */}
      <div className="card">
        <div className="header">
          <h2>Open Tasks <span className="badge badge-open">{open.length}</span></h2>
          <button className="btn" onClick={load}>↻ Refresh</button>
        </div>
        {open.length === 0
          ? <div className="empty">🎉 No open tasks!</div>
          : open.map(t => (
            <div className="task-row" key={t.id}>
              <span className="task-id">#{t.id}</span>
              <span className="task-title">{t.title}</span>
              {t.assigned_to && <span className="task-assigned">→ {t.assigned_to}</span>}
              <span className="task-date">{fmtDate(t.created_at)}</span>
              <div className="task-actions">
                <button className="btn btn-success" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => completeTask(t.id)}>✅</button>
                <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteTask(t.id)}>🗑</button>
              </div>
            </div>
          ))}
      </div>

      {/* Done tasks toggle */}
      <div className="card">
        <div className="header">
          <h2>Completed Tasks <span className="badge badge-done">{done.length}</span></h2>
          <button className="btn" onClick={() => setShowDone(v => !v)}>{showDone ? 'Hide' : 'Show'}</button>
        </div>
        {showDone && (
          done.length === 0
            ? <div className="empty">Nothing completed yet.</div>
            : [...done].reverse().map(t => (
              <div className="task-row" key={t.id} style={{ opacity: 0.6 }}>
                <span className="task-id">#{t.id}</span>
                <span className="task-title" style={{ textDecoration: 'line-through' }}>{t.title}</span>
                {t.done_by && <span className="task-assigned">by {t.done_by}</span>}
                <span className="task-date">{fmtDate(t.done_at)}</span>
                <div className="task-actions">
                  <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteTask(t.id)}>🗑</button>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────
function SettingsTab() {
  const [form, setForm] = useState({
    BOT_TOKEN: '', ALLOWED_CHAT_ID: '', NUDGE_HOUR: '8', NUDGE_MINUTE: '0',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(null);
  const [showToken, setShowToken] = useState(false);

  function notify(msg, type = 'success') { setFlash({ msg, type }); }

  useEffect(() => {
    api('/api/settings').then(d => { setForm(f => ({ ...f, ...d })); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify(form) });
      notify('Settings saved ✅ (restart bot to apply)');
    } catch (err) { notify(err.message, 'error'); }
    finally { setSaving(false); }
  }

  async function sendNudge() {
    try {
      await api('/api/nudge', { method: 'POST' });
      notify('Nudge sent to Telegram! 📣');
    } catch (err) { notify(err.message, 'error'); }
  }

  function field(key, label, opts = {}) {
    return (
      <div className="form-group">
        <label className="label">{label}</label>
        <input
          className="input"
          type={opts.type || 'text'}
          value={form[key] ?? ''}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          placeholder={opts.placeholder || ''}
        />
      </div>
    );
  }

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div>
      {flash && <Alert msg={flash.msg} type={flash.type} onClose={() => setFlash(null)} />}
      <form onSubmit={save}>
        <div className="card">
          <h2>🤖 Bot</h2>
          <div className="settings-grid">
            <div className="form-group">
              <label className="label">Bot Token</label>
              <div className="form-row" style={{ margin: 0 }}>
                <input
                  className="input"
                  type={showToken ? 'text' : 'password'}
                  value={form.BOT_TOKEN ?? ''}
                  onChange={e => setForm(f => ({ ...f, BOT_TOKEN: e.target.value }))}
                  placeholder="123456:ABC…"
                />
                <button type="button" className="btn" onClick={() => setShowToken(v => !v)} style={{ flexShrink: 0 }}>
                  {showToken ? '🙈' : '👁'}
                </button>
              </div>
            </div>
            {field('ALLOWED_CHAT_ID', 'Allowed Chat ID', { placeholder: 'e.g. -1001234567890' })}
          </div>
        </div>

        <div className="card">
          <h2>⏰ Daily Nudge</h2>
          <p className="muted" style={{ marginBottom: 14 }}>Bot will send open tasks to the group at this time every day.</p>
          <div className="settings-grid">
            <div className="form-group">
              <label className="label">Hour (0–23)</label>
              <input
                className="input" type="number" min="0" max="23"
                value={form.NUDGE_HOUR ?? '8'}
                onChange={e => setForm(f => ({ ...f, NUDGE_HOUR: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="label">Minute (0–59)</label>
              <input
                className="input" type="number" min="0" max="59"
                value={form.NUDGE_MINUTE ?? '0'}
                onChange={e => setForm(f => ({ ...f, NUDGE_MINUTE: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : '💾 Save Settings'}
          </button>
          <button className="btn" type="button" onClick={sendNudge}>
            📣 Send Nudge Now
          </button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>⚠️ Restart the bot process after saving to apply changes.</p>
      </form>
    </div>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('tasks');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>🤖 NudgeBot</h1>
          <p className="muted">Couples task manager dashboard</p>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="badge badge-open">{stats.open} open</span>
            <span className="badge badge-done">{stats.done} done</span>
          </div>
        )}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>📋 Tasks</button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>⚙️ Settings</button>
      </div>

      {tab === 'tasks' && <TasksTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}
