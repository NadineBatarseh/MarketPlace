import { useTranslation } from 'react-i18next';
import zxcvbn from 'zxcvbn';

interface Props {
  password: string;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#22c55e'];
const STRENGTH_KEYS = ['veryWeak', 'weak', 'fair', 'good', 'strong'] as const;

export default function PasswordStrengthBar({ password }: Props) {
  const { t } = useTranslation('auth');
  if (!password) return null;

  const result = zxcvbn(password);
  const score = result.score as 0 | 1 | 2 | 3 | 4;
  const color = COLORS[score];
  const filledSegments = score + 1;

  const suggestions: string[] = [];
  if (result.feedback.warning) suggestions.push(result.feedback.warning);
  result.feedback.suggestions.slice(0, 2).forEach(s => suggestions.push(s));

  return (
    <div className="psb-wrap">
      <div className="psb-bars">
        {COLORS.map((_, i) => (
          <div
            key={i}
            className="psb-segment"
            style={{
              background: i < filledSegments ? color : '#e5e7eb',
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>
      <span className="psb-label" style={{ color }}>
        {t(`passwordStrength.${STRENGTH_KEYS[score]}`)}
      </span>
      {suggestions.length > 0 && (
        <p className="psb-hint">{suggestions[0]}</p>
      )}
    </div>
  );
}
