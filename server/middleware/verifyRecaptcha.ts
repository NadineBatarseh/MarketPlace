import type { Request, Response, NextFunction } from 'express';

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const ARABIC_ERROR = 'فشل التحقق من أنك لست روبوتًا، يرجى المحاولة مرة أخرى';

async function checkToken(
  token: string,
  expectedAction: string
): Promise<{ ok: boolean }> {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  if (!secretKey) {
    console.error('[reCAPTCHA] RECAPTCHA_SECRET_KEY is not set — skipping verification');
    return { ok: true };
  }

  const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE ?? '0.5');

  const params = new URLSearchParams({ secret: secretKey, response: token });
  const resp = await fetch(`${VERIFY_URL}?${params}`);
  const body = await resp.json() as {
    success: boolean;
    score?: number;
    action?: string;
    'error-codes'?: string[];
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[reCAPTCHA] action=${body.action} score=${body.score}`);
  }

  if (!body.success) return { ok: false };
  if (body.action !== expectedAction) return { ok: false };
  if (body.score === undefined || body.score < minScore) return { ok: false };

  return { ok: true };
}

export function verifyRecaptcha(expectedAction: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { recaptchaToken } = req.body as { recaptchaToken?: string };

    if (!recaptchaToken) {
      res.status(400).json({ ok: false, error: ARABIC_ERROR });
      return;
    }

    try {
      const result = await checkToken(recaptchaToken, expectedAction);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: ARABIC_ERROR });
        return;
      }
      next();
    } catch (err) {
      console.error('[reCAPTCHA] verification failed:', err);
      res.status(500).json({ ok: false, error: ARABIC_ERROR });
    }
  };
}

// For routes where the action is sent in the body (e.g. shared upload endpoint)
export function verifyRecaptchaFromBody(allowedActions: string[]) {
  const allowed = new Set(allowedActions);
  return async (req: Request, res: Response, next: NextFunction) => {
    const { recaptchaToken, recaptchaAction } = req.body as {
      recaptchaToken?: string;
      recaptchaAction?: string;
    };

    if (!recaptchaToken || !recaptchaAction) {
      res.status(400).json({ ok: false, error: ARABIC_ERROR });
      return;
    }

    if (!allowed.has(recaptchaAction)) {
      res.status(400).json({ ok: false, error: ARABIC_ERROR });
      return;
    }

    try {
      const result = await checkToken(recaptchaToken, recaptchaAction);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: ARABIC_ERROR });
        return;
      }
      next();
    } catch (err) {
      console.error('[reCAPTCHA] verification failed:', err);
      res.status(500).json({ ok: false, error: ARABIC_ERROR });
    }
  };
}

export { checkToken, ARABIC_ERROR };
