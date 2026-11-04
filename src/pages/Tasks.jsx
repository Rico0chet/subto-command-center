import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { ymd, addDays, dueLabel, dueClass, useOptions, useDataChanged, dataChanged, openRecord, Select } from '../crm/shared.jsx';

export default function Tasks({ flash }) {
  const opts = useOptions();
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(ymd());
  const [priority, setPriority] = useState('Normal');
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => setTasks(await window.hub.crm.listTasks({ includeDone: true })), []);
  useEffect(() => { load(); }, [load]);
  useDataChanged(load);
  if (!opts) return null;

  const add = async (e) => {
    e.preventDefault();
    try {
      await window.hub.crm.saveTask({ title, due_date: due, priority });
      setTitle('');
      load(); dataChanged();
    } catch (err) { flash(err.message); }
  };
  const toggle = async (t) => { await window.hub.crm.setTaskDone(t.id, !t.done); load(); dataChanged(); };
  const del = async (t) => { await window.hub.crm.deleteTask(t.id); load(); dataChanged(); };
  const reschedule = async (t, date) => { await window.hub.crm.saveTask({ ...t, due_date: date }); load(); dataChanged(); };

  const t0 = ymd();
  const open = tasks.filter((t) => !t.done);
  const groups = [
    ['Overdue', open.filter((t) => t.due_date && t.due_date < t0), 'due-over'],
    ['Today', open.filter((t) => t.due_date === t0), 'due-today'],
    ['Upcoming', open.filter((t) => t.due_date && t.due_date > t0), ''],
    ['No date', open.filter((t) => !t.due_date), ''],
  ];
  const done = tasks.filter((t) => t.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')).slice(0, 30);

  const Row = ({ t }) => (
    <li className={t.done ? 'done' : ''}>
      <input type="checkbox" checked={t.done} onChange={() => toggle(t)} />
      <span className="t-title">{t.priority === 'High' && !t.done && <span className="hi" title="High priority">!</span>}{t.title}</span>
      {t.deal_title && <button className="linkish small" onClick={() => openRecord('deal', t.deal_id)}>🏠 {t.deal_title}</button>}
      {t.contact_name && <button className="linkish small" onClick={() => openRecord('contact', t.contact_id)}>👤 {t.contact_name}</button>}
      {!t.done && (
        <input type="date" className={`date-chip ${dueClass(t.due_date)}`} value={t.due_date || ''} onChange={(e) => reschedule(t, e.target.value)} title="Change due date" />
      )}
      {t.done && t.due_date && <span className="due">{dueLabel(t.due_date)}</span>}
      <button className="icon-btn" title="Delete task" onClick={() => del(t)}>✕</button>
    </li>
  );

  return (
    <div className="page">
      <header className="page-head"><h1><Icon name="check" size={24} /> Tasks</h1></header>
      <section className="card">
        <form className="row" onSubmit={add}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task, e.g. Call 10 agents about expired listings" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 150, minWidth: 150 }} />
          <Select value={priority} onChange={setPriority} options={opts.priorities} />
          <button className="primary" type="submit">Add task</button>
        </form>
        <div className="quick-dates">
          {[['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([l, n]) => (
            <button key={l} type="button" className={`mini ${due === addDays(n) ? 'on' : ''}`} onClick={() => setDue(addDays(n))}>{l}</button>
          ))}
          <button type="button" className={`mini ${!due ? 'on' : ''}`} onClick={() => setDue('')}>No date</button>
        </div>
        <p className="muted small">Tip: tasks for a specific deal or person are easiest to add from that deal or contact.</p>
      </section>

      {groups.map(([name, list, cls]) => list.length > 0 && (
        <section key={name} className="card">
          <h2 className={cls}>{name} <span className="count">{list.length}</span></h2>
          <ul className="tasks">{list.map((t) => <Row key={t.id} t={t} />)}</ul>
        </section>
      ))}
      {open.length === 0 && <section className="card muted">Nothing to do. Add a task above, or from a deal or contact.</section>}

      <section className="card">
        <button className="linkish" onClick={() => setShowDone(!showDone)}>{showDone ? '▾' : '▸'} Done ({tasks.filter((t) => t.done).length})</button>
        {showDone && <ul className="tasks">{done.map((t) => <Row key={t.id} t={t} />)}</ul>}
      </section>
    </div>
  );
}
