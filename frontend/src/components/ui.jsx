export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="close" />
      <div className={`card relative max-h-[92vh] w-full overflow-auto p-5 ${wide ? 'max-w-4xl' : 'max-w-xl'}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button className="btn btn-ghost" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

export function Empty({ text }) {
  return <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>{text}</div>;
}

export function Pagination({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 p-3">
      <button className="btn btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
      <span className="text-sm">{page} / {pages}</span>
      <button className="btn btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button>
    </div>
  );
}
