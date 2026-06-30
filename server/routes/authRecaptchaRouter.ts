import { Router } from 'express';
import type { Request, Response } from 'express';
import { checkToken, ARABIC_ERROR } from '../middleware/verifyRecaptcha.js';

const router = Router();

const ALLOWED_ACTIONS = new Set([
  'login',
  'signup',
  'merchant_login',
  'forgot_password',
]);

// POST /api/auth/verify-recaptcha
// Called by auth forms that submit directly to Supabase (no backend route to middleware).
// Verifies the token + action and returns { ok: true } so the frontend can proceed.
router.post('/verify-recaptcha', async (req: Request, res: Response) => {
  const { recaptchaToken, recaptchaAction } = req.body as {
    recaptchaToken?: string;
    recaptchaAction?: string;
  };

  if (!recaptchaToken || !recaptchaAction) {
    res.status(400).json({ ok: false, error: ARABIC_ERROR });
    return;
  }

  if (!ALLOWED_ACTIONS.has(recaptchaAction)) {
    res.status(400).json({ ok: false, error: ARABIC_ERROR });
    return;
  }

  try {
    const result = await checkToken(recaptchaToken, recaptchaAction);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: ARABIC_ERROR });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[reCAPTCHA] auth verify failed:', err);
    res.status(500).json({ ok: false, error: ARABIC_ERROR });
  }
});

export default router;
