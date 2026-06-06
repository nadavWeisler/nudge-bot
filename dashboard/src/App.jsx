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
  if (!s) return '—';
  return new Date(s + 'Z').toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Monitor tab ───────────────────────────────────────────────────────────────
function MonitorTab() {
  const [tasks, setTasks]     = useState([]);
  const [stats, setStats]     = useState(null);
  const [filter, setFilter]   = useState('open');
  const [loading, setLoading] = useState(true);
  const [flash, setFlash]     = useState(null);

  // Add task form
  const [title, setTitle]       = useState('');
  const [assigned, setAssigned] = useState('');
  const [adding, setAdding]     = useState(false);
  const [users, setUsers]       = useState([]);

  const notify = (msg, type = 'success') => setFlash({ msg, type });

  const load = useCallback(async () => {
    const [t, s, u] = await Promise.all([
      api('/api/tasks?status=' + filter).catch(() => []),
      api('/api/stats').catch(() => null),
      api('/api/users').catch(() => []),
    ]);
    setTasks(t || []); setStats(s); setUsers(u || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function addTask(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: title.trim(), assigned_to: assigned }) });
      setTitle(''); setAssigned('');
      await load();
      notify('Task added ✅');
    } catch (err) { notify(err.message, 'error'); }
    finally { setAdding(false); }
  }

  async function deleteTask(id, title) {
    if (!confirm(`Delete "${title}"?`)) return;
    try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); await load(); notify('Deleted 🗑'); }
    catch (err) { notify(err.message, 'error'); }
  }

  const byAssignee = tasks
    .filter(t => t.status === 'open')
    .reduce((acc, t) => {
      const k = t.assigned_to || '⬜ Unassigned';
      (acc[k] = acc[k] || []).push(t);
      return acc;
    }, {});

  return (
    <div>
      {flash && <Alert msg={flash.msg} type={flash.type} onClose={() => setFlash(null)} />}

      {/* Stats strip */}
      {stats && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
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

      {/* Add task */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 12 }}>➕ Add Task</h2>
        <form onSubmit={addTask}>
          <div className="form-row">
            <input
              className="input"
              placeholder="Task description…"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
            {users.length > 0 ? (
              <select
                className="input"
                value={assigned}
                onChange={e => setAssigned(e.target.value)}
                style={{ maxWidth: 160 }}
              >
                <option value="">Unassigned</option>
                {users.map(u => <option key={u.user_id} value={u.name}>{u.name}</option>)}
              </select>
            ) : (
              <input
                className="input"
                placeholder="Assign to…"
                value={assigned}
                onChange={e => setAssigned(e.target.value)}
                style={{ maxWidth: 160 }}
              />
            )}
            <button className="btn btn-primary" disabled={adding} style={{ flexShrink: 0 }}>
              {adding ? '…' : '+ Add'}
            </button>
          </div>
        </form>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {[['open', '🔵 Open'], ['done', '✅ Done']].map(([f, label]) => (
          <button key={f} className={`btn ${filter === f ? 'btn-primary' : ''}`} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
        <button className="btn" onClick={load} style={{ marginLeft: 'auto' }} title="Refresh">↻</button>
        <span style={{ color: 'var(--text2)', fontSize: 12 }}>Auto-refresh 15s</span>
      </div>

      {/* Task list */}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : tasks.length === 0 ? (
        <div className="empty">🎉 {filter === 'open' ? 'No open tasks!' : 'Nothing completed yet.'}</div>
      ) : filter === 'open' ? (
        Object.entries(byAssignee).map(([person, group]) => (
          <div className="card" key={person} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <strong>{person}</strong>
              <span className="badge badge-open">{group.length}</span>
            </div>
            {group.map(t => (
              <div className="task-row" key={t.id}>
                <span className="task-id">#{t.id}</span>
                <span className="task-title">{t.title}</span>
                <span className="task-date" style={{ marginLeft: 'auto' }}>{fmtDate(t.created_at)}</span>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>by {t.created_by}</span>
                <button
                  className="btn btn-danger"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => deleteTask(t.id, t.title)}
                  title="Delete"
                >🗑</button>
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
              <span className="task-date" style={{ marginLeft: 'auto' }}>{fmtDate(t.done_at)}</span>
              <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✅ {t.done_by}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Commands tab ──────────────────────────────────────────────────────────────
const COMMANDS = [
  { group: 'Adding tasks',
    items: [
      { cmd: null,          desc: 'Just type any message',   detail: 'Sends text → creates task, then asks who to assign it to' },
    ]
  },
  { group: 'Viewing tasks',
    items: [
      { cmd: '/list',       desc: 'All open tasks',          detail: 'Grouped by assignee — Yours / Theirs / Unassigned — with ✅ buttons' },
      { cmd: '/mine',       desc: 'Your tasks only',         detail: 'Shows tasks assigned to you with done buttons' },
      { cmd: '/theirs',     desc: 'Others\' tasks',          detail: 'Tasks assigned to someone else' },
      { cmd: '/history',    desc: 'Recently completed',      detail: 'Last 15 finished tasks' },
      { cmd: '/stats',      desc: 'Summary',                 detail: 'Open per person + who completed what' },
    ]
  },
  { group: 'Managing tasks',
    items: [
      { cmd: '/done 3',     desc: 'Mark task #3 done',       detail: 'Or tap the ✅ button on any task message' },
      { cmd: '/assign 3',   desc: 'Reassign task #3',        detail: 'Shows a people-picker keyboard' },
      { cmd: '/delete 3',   desc: 'Delete task #3',          detail: 'Permanently removes the task' },
    ]
  },
  { group: 'Reminders',
    items: [
      { cmd: '/nudge',      desc: 'Send reminder now',       detail: 'Posts all open tasks to the chat immediately' },
    ]
  },
  { group: 'Setup',
    items: [
      { cmd: '/chatid',     desc: 'Get your chat ID',        detail: 'Use this to configure Allowed Chat IDs in Settings' },
      { cmd: '/start',      desc: 'Welcome message',         detail: '' },
      { cmd: '/help',       desc: 'Show all commands',       detail: '' },
    ]
  },
];

function CommandsTab() {
  const [copied, setCopied] = useState('');

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(''), 1500);
    });
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }}>
        <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
          💡 <strong style={{ color: 'var(--text)' }}>Just send any text</strong> in the Telegram chat to add a task — no command needed.
          The bot will ask who to assign it to.
        </p>
      </div>

      {COMMANDS.map(({ group, items }) => (
        <div className="card" key={group} style={{ marginBottom: 12 }}>
          <h2 style={{ marginBottom: 12, color: 'var(--text2)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {group}
          </h2>
          {items.map(({ cmd, desc, detail }) => (
            <div key={cmd || desc} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}
              className="cmd-row"
            >
              <div style={{ minWidth: 120 }}>
                {cmd ? (
                  <button
                    className="cmd-pill"
                    onClick={() => copy(cmd)}
                    title="Copy"
                  >
                    {copied === cmd ? '✅ copied' : cmd}
                  </button>
                ) : (
                  <span className="cmd-pill cmd-pill-text">💬 text</span>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{desc}</div>
                {detail && <div style={{ color: 'var(--text2)', fontSize: 12, marginTop: 2 }}>{detail}</div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── ListEditor ────────────────────────────────────────────────────────────────
function ListEditor({ label, items, onChange, placeholder, validate }) {
  const [draft, setDraft] = useState('');
  const [err, setErr]     = useState('');

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
  const [form, setForm]     = useState({ bot_token: '', chat_ids: [], nudge_schedules: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [flash, setFlash]     = useState(null);
  const [showToken, setShowToken] = useState(false);

  const notify = (msg, type = 'success') => setFlash({ msg, type });

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

  const validateChatId = v => !/^-?\d+$/.test(v) ? 'Must be a numeric ID' : undefined;
  const validateTime   = v => {
    if (!/^\d{1,2}:\d{2}$/.test(v)) return 'Use HH:MM (e.g. 08:00)';
    const [h, m] = v.split(':').map(Number);
    if (h > 23 || m > 59) return 'Invalid time';
  };

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
            Your Telegram user ID and your wife's. Send <code>/chatid</code> to the bot in DM to get yours.
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
const TABS = [
  { id: 'monitor',  label: '📊 Tasks' },
  { id: 'commands', label: '💬 Commands' },
  { id: 'settings', label: '⚙️ Settings' },
];

export default function App() {
  const [tab, setTab]     = useState('monitor');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api('/api/stats').then(setStats).catch(() => {});
    const id = setInterval(() => api('/api/stats').then(setStats).catch(() => {}), 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>🤖 NudgeBot</h1>
          <p className="muted">Couples task manager</p>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="badge badge-open">{stats.open} open</span>
            <span className="badge badge-done">{stats.done} done</span>
          </div>
        )}
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'monitor'  && <MonitorTab />}
      {tab === 'commands' && <CommandsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}
