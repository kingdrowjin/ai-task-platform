import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

const OPERATIONS = [
  { value: 'uppercase', label: 'Uppercase' },
  { value: 'lowercase', label: 'Lowercase' },
  { value: 'reverse', label: 'Reverse string' },
  { value: 'word_count', label: 'Word count' },
];

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [input, setInput] = useState('');
  const [operation, setOperation] = useState('uppercase');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listTasks();
      setTasks(data.tasks || []);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.createTask({ title, input, operation });
      setTitle('');
      setInput('');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <h1>Tasks</h1>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>New task</h3>
        <form onSubmit={submit} className="col">
          <div>
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </div>
          <div>
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value)}>
              {OPERATIONS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Input text</label>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} required maxLength={10000} />
          </div>
          {err && <div className="error">{err}</div>}
          <div>
            <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Run task'}</button>
          </div>
        </form>
      </div>

      <h3>Recent</h3>
      {tasks.length === 0 ? (
        <p className="muted">No tasks yet — create one above.</p>
      ) : (
        <div className="task-list">
          {tasks.map((t) => (
            <Link key={t._id} to={`/tasks/${t._id}`} className="task-item" style={{ color: 'inherit' }}>
              <div>
                <div style={{ fontWeight: 500 }}>{t.title}</div>
                <div className="muted">{t.operation} · {formatTime(t.createdAt)}</div>
              </div>
              <span className={`badge ${t.status}`}>{t.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
