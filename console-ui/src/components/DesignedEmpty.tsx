/**
 * DesignedEmpty — editorial empty state component.
 * Headline in Fraunces, body in Hanken Grotesk, optional mono command.
 */
interface DesignedEmptyProps {
  headline: string;
  body?: string;
  command?: string;
}

export function DesignedEmpty({ headline, body, command }: DesignedEmptyProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-headline">{headline}</span>
      {body ? <p className="empty-state-body">{body}</p> : null}
      {command ? <code className="empty-state-command">{command}</code> : null}
    </div>
  );
}
