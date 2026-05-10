import express from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import crypto from 'crypto';

const router = express.Router();

// Short-lived in-memory store: state_token (UUID) → { sbAuthToken, expiresAt }
// Avoids passing the full JWT (hundreds of chars) to Facebook's state param.
const pendingStates = new Map<string, { sbAuthToken: string; expiresAt: number }>();

// Clean up expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (val.expiresAt < now) pendingStates.delete(key);
  }
}, 5 * 60 * 1000);

const SCOPES = [
  'instagram_basic',
  'pages_show_list',
  'pages_read_engagement',
].join(',');

/**
 * POST /api/instagram/init
 * Frontend calls this to get a short state token, then redirects to the returned auth_url.
 */
router.post('/init', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ ok: false, error: 'Missing Authorization header' });

  const sbAuthToken = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(sbAuthToken);
  if (error || !user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const stateToken = crypto.randomUUID();
  pendingStates.set(stateToken, {
    sbAuthToken,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  const redirectUri =
    process.env.INSTAGRAM_REDIRECT_URI ||
    'http://localhost:4000/auth/instagram/callback';

  const authUrl =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${process.env.META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&response_type=code` +
    `&state=${stateToken}`;

  return res.json({ ok: true, auth_url: authUrl });
});

/**
 * GET /auth/instagram/callback
 * Facebook redirects here after the merchant approves Instagram permissions.
 * Flow: state_token → JWT → code exchange → long-lived token → discover IG account → save to DB
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state: stateToken } = req.query as { code?: string; state?: string };

  if (!code) return res.status(400).send('Missing authorization code.');
  if (!stateToken) return res.status(401).send('Missing state token.');

  const pending = pendingStates.get(stateToken);
  if (!pending || pending.expiresAt < Date.now()) {
    return res.status(401).send('State token expired or invalid. Please try connecting again.');
  }
  pendingStates.delete(stateToken); // one-time use

  const { sbAuthToken } = pending;

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser(sbAuthToken);
    if (userError || !user) return res.status(401).send('Invalid session token.');

    const redirectUri =
      process.env.INSTAGRAM_REDIRECT_URI ||
      'http://localhost:4000/auth/instagram/callback';

    // 1. Exchange code for short-lived user access token
    const shortRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        redirect_uri: redirectUri,
        code,
      })
    );
    const shortData: any = await shortRes.json();

    if (!shortData.access_token) {
      const msg = shortData.error?.message ?? 'unknown error';
      console.error('[instagram/callback] short-lived token error:', msg);
      return res.status(400).send(`فشل الحصول على رمز الوصول: ${msg}`);
    }

    // 2. Exchange for long-lived token (~60 days)
    const longRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        fb_exchange_token: shortData.access_token,
      })
    );
    const longData: any = await longRes.json();
    console.log('[instagram/callback] short token prefix:', shortData.access_token?.slice(0, 30));
    console.log('[instagram/callback] long token exchange result:', JSON.stringify(longData));
    const accessToken: string = longData.access_token ?? shortData.access_token;
    console.log('[instagram/callback] final token prefix:', accessToken?.slice(0, 30), '| is long-lived:', !!longData.access_token);

    // 3. Discover the Instagram Business Account linked to the merchant's Facebook pages
    let instagramAccountId: string | null = null;
    let instagramUsername: string | null = null;

    try {
      const pagesRes = await fetch(
        `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
      );
      const pagesData: any = await pagesRes.json();

      for (const page of pagesData.data ?? []) {
        const igRes = await fetch(
          `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
        );
        const igData: any = await igRes.json();

        if (igData.instagram_business_account?.id) {
          instagramAccountId = igData.instagram_business_account.id;

          const profileRes = await fetch(
            `https://graph.facebook.com/v19.0/${instagramAccountId}?fields=username&access_token=${accessToken}`
          );
          const profileData: any = await profileRes.json();
          instagramUsername = profileData.username ?? null;
          break;
        }
      }
    } catch (err) {
      console.warn('[instagram/callback] account discovery failed:', (err as Error).message);
    }

    // 4. Save to DB
    const { error: saveError } = await supabase
      .from('instagram_connections')
      .upsert(
        {
          user_id: user.id,
          access_token: accessToken,
          instagram_account_id: instagramAccountId,
          username: instagramUsername,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (saveError) {
      console.error('[instagram/callback] DB save error:', saveError.message);
      return res.status(500).send(`فشل حفظ بيانات الاتصال: ${saveError.message}`);
    }

    console.log(`[instagram/callback] connected IG account ${instagramUsername ?? instagramAccountId} for user ${user.id}`);

    // 5. Redirect merchant back to the dashboard
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/merchant-dashboard?page=instagramConnect&connected=true`);

  } catch (err: any) {
    console.error('[instagram/callback] unexpected error:', err.message);
    res.status(500).send(`خطأ في السيرفر: ${err.message}`);
  }
});

/**
 * GET /api/instagram/status
 */
router.get('/status', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ ok: false, error: 'Missing Authorization header' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const { data } = await supabase
    .from('instagram_connections')
    .select('instagram_account_id, username, created_at')
    .eq('user_id', user.id)
    .maybeSingle();

  return res.json({
    ok: true,
    connected: !!data,
    instagram_account_id: data?.instagram_account_id ?? null,
    username: data?.username ?? null,
    connected_at: data?.created_at ?? null,
  });
});

/**
 * DELETE /api/instagram/disconnect
 */
router.delete('/disconnect', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ ok: false, error: 'Missing Authorization header' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ ok: false, error: 'Invalid token' });

  const { error: delError } = await supabase
    .from('instagram_connections')
    .delete()
    .eq('user_id', user.id);

  if (delError) return res.status(500).json({ ok: false, error: delError.message });

  return res.json({ ok: true });
});

export default router;
