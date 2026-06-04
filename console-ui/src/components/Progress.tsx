export function Progress({ value }: { value?: number }) {
  const normalized = Math.max(0, Math.min(100, value || 0));
  return <div className="progress"><span style={{ width: `${normalized}%` }} /></div>;
}
