import React, { useEffect, useRef, useState } from 'react';

// In-app replacement for window.confirm(). Native confirm boxes break typing
// in Electron on Windows (text boxes stop taking keys afterwards), so we never use them.
let open = null;
export function askConfirm(message, okLabel = 'OK') {
  return new Promise((resolve) => {
    if (!open) { resolve(false); return; }
    open({ message, okLabel, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState(null);
  const okRef = useRef(null);
  useEffect(() => { open = setReq; return () => { open = null; }; }, []);
  useEffect(() => { if (req && okRef.current) okRef.current.focus(); }, [req]);
  if (!req) return null;
  const done = (v) => { req.resolve(v); setReq(null); };
  return (
    <div className="modal-back" onMouseDown={() => done(false)}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') done(false); }}>
        {String(req.message).split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={() => done(false)}>Cancel</button>
          <button className="primary" ref={okRef} onClick={() => done(true)}>{req.okLabel}</button>
        </div>
      </div>
    </div>
  );
}
