import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getTodaySummaryBulk, type CourierTodayMinutes } from '../logistics/workSessions.js';

const router = Router();

// â”€â”€ GET /api/admin/couriers/work-summary/today â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Admin Dashboard "Ù†Ø´Ø§Ø· Ø¬ÙŠØ¯ / ÙˆÙ‚Øª Ø§Ù†ØªØ¸Ø§Ø± Ù…Ø±ØªÙØ¹" indicator â€” operational
// monitoring only, never used for payroll. Query: ?courier_ids=id1,id2,...
router.get('/work-summary/today', requireAdmin, async (req: Request, res: Response) => {
  const raw = req.query.courier_ids as string | undefined;
  const courierIds = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  if (!courierIds.length) {
    res.json({ success: true, summaries: {} });
    return;
  }

  try {
    const bulk = await getTodaySummaryBulk(courierIds);
    const summaries: Record<string, CourierTodayMinutes> = {};
    for (const [id, minutes] of bulk) summaries[id] = minutes;
    res.json({ success: true, summaries });
  } catch (err) {
    console.error('[Admin] /couriers/work-summary/today error:', err);
    res.status(500).json({ success: false, error: 'Failed to load courier work summaries' });
  }
});

export default router;
