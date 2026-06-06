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
function ListEditor({ label, items, onChange, placeholder, validate }) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (validate) { const msg = validate(v); if (msg) { setErr(msg); return; } }
    if (items.includes(v)) { setErr('Already in list'); return; }
    onChange([...items, v]);
    setDraft(''); setErr('');
  }

  return (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label className="label">{label}</label>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{
            flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '7px 12px', fontSize: 13,
          }}>{item}</span>
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
      notify('Nudge sent to all chats! 📣');
    } catch (err) { notify(err.message, 'error'); }
  }

  function validateChatId(v) {
    if (!/^-?\d+$/.test(v)) return 'Must be a numeric ID (e.g. 123456789 or -1001234567890)';
  }
  function validateTime(v) {
    if (!/^\d{1,2}:\d{2}$/.test(v)) return 'Use HH:MM format (e.g. 08:00)';
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
                value={form.bot_token ?? ''}
                onChange={e => setForm(f => ({ ...f, bot_token: e.target.value }))}
                placeholder="123456:ABC…" />
              <button type="button" className="btn" onClick={() => setShowToken(v => !v)} style={{ flexShrink: 0 }}>
                {showToken ? '🙈' : '👁'}
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>👥 Allowed Chat IDs</h2>
          <p className="muted" style={{ marginBottom: 14 }}>
            Add your Telegram user ID and your wife's. Send <code>/chatid</code> to the bot in DM to find yours.
          </p>
          <ListEditor
            label="Chat IDs"
            items={form.chat_ids}
            onChange={ids => setForm(f => ({ ...f, chat_ids: ids }))}
            placeholder="e.g. 123456789"
            validate={validateChatId}
          />
        </div>

        <div className="card">
          <h2>⏰ Daily Nudge Schedules</h2>
          <p className="muted" style={{ marginBottom: 14 }}>
            Add one or more times — the bot sends all open tasks at each time every day.
          </p>
          <ListEditor
            label="Nudge times"
            items={form.nudge_schedules}
            onChange={times => setForm(f => ({ ...f, nudge_schedules: times }))}
            placeholder="HH:MM e.g. 08:00"
            validate={validateTime}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : '💾 Save Settings'}
          </button>
          <button className="btn" type="button" onClick={sendNudge}>
            📣 Send Nudge Now
          </button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>⚠️ Restart the bot process after saving to apply schedule changes.</p>
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
