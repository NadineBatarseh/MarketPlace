import zxcvbn from 'zxcvbn';

interface Props {
  password: string;
}

const LEVELS = [
  { label: 'ضعيف جداً', color: '#ef4444' },
  { label: 'ضعيف',      color: '#f97316' },
  { label: 'مقبول',     color: '#eab308' },
  { label: 'جيد',       color: '#3b82f6' },
  { label: 'قوي',       color: '#22c55e' },
];

export default function PasswordStrengthBar({ password }: Props) {
  if (!password) return null;

  const result = zxcvbn(password);
  const score = result.score as 0 | 1 | 2 | 3 | 4;
  const level = LEVELS[score];
  const filledSegments = score + 1;

  const suggestions: string[] = [];
  if (result.feedback.warning) suggestions.push(result.feedback.warning);
  result.feedback.suggestions.slice(0, 2).forEach(s => suggestions.push(s));

  return (
    <div className="psb-wrap" dir="rtl">
      <div className="psb-bars">
        {LEVELS.map((_, i) => (
          <div
            key={i}
            className="psb-segment"
            style={{
              background: i < filledSegments ? level.color : '#e5e7eb',
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>
      <span className="psb-label" style={{ color: level.color }}>
        {level.label}
      </span>
      {suggestions.length > 0 && (
        <p className="psb-hint">{suggestions[0]}</p>
      )}
    </div>
  );
}
