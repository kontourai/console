export function Badge({ value }: { value: string }) {
  return <span className={`badge tone-${toneFor(value)}`}>{value}</span>;
}

function toneFor(value: string) {
  if (/(passed|verified|fresh|completed|accepted)/i.test(value)) return "good";
  if (/(failed|blocked|stale|error|rejected)/i.test(value)) return "bad";
  if (/(open|waiting|running|pending)/i.test(value)) return "warn";
  return "neutral";
}
