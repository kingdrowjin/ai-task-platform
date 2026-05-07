import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';

export default function TaskDetail() {
  const { id } = useParams();
  const [task, setTask] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const t = await api.getTask(id);
      setTask(t);
    } catch (e) {
      setErr(e.message);
    }
  }, [id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [load]);

  if (err) return <div className="container"><div className="error">{err}</div></div>;
  if (!task) return <div className="container"><p className="muted">Loading…</p></div>;

  const stillRunning = task.status === 'pending' || task.status === 'running';

  return (
    <div className="container">
      <Link to="/" className="muted">← Back</Link>
      <h1>{task.title}</h1>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <span className={`badge ${task.status}`}>{task.status}</span>
        <span className="muted">{task.operation}</span>
      </div>

      <div className="card">
        <label>Input</label>
        <div className="mono" style={{ whiteSpace: 'pre-wrap' }}>{task.input}</div>
      </div>

      {task.result !== null && task.result !== undefined && (
        <div className="card">
          <label>Result</label>
          <div className="mono" style={{ whiteSpace: 'pre-wrap' }}>{task.result}</div>
        </div>
      )}

      {task.error && (
        <div className="card">
          <label>Error</label>
          <div className="error mono">{task.error}</div>
        </div>
      )}

      <div className="card">
        <label>Logs {stillRunning && <span className="muted">(updating…)</span>}</label>
        <div className="logs">
          {(task.logs || []).length === 0 ? '—' : task.logs.join('\n')}
        </div>
      </div>
    </div>
  );
}
