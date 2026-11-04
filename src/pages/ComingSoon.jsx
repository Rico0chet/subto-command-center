import React from 'react';
import Icon from '../Icon.jsx';

export default function ComingSoon({ item }) {
  if (!item) return null;
  return (
    <div className="page">
      <header className="page-head">
        <h1><Icon name={item.icon} size={24} /> {item.label}</h1>
      </header>
      <section className="card soon-card">
        <div className="soon-badge">Coming in phase {item.phase}</div>
        <p>{item.blurb}</p>
      </section>
    </div>
  );
}
