import { Router, Request, Response } from 'express';
import { startWork, endWork, getTodaySummary, getMonthlyHistory } from '../logistics/workSessions.js';

const router = Router();

// â”€â”€ POST /api/couriers/start-work â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Body: { courier_id }
router.post('/start-work', async (req: Request, res: Response) => {
  const { courier_id } = req.body as { courier_id: string };
  if (!courier_id) {
    res.status(400).json({ success: false, error: 'courier_id is required' });
    return;
  }

  try {
    const result = await startWork(courier_id);
    if (result.success) {
      res.json({ success: true, session: result.session });
    } else {
      res.status(409).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error('[Couriers] /start-work error:', err);
    res.status(500).json({ success: false, error: 'Failed to start work' });
  }
});

// â”€â”€ POST /api/couriers/end-work â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Body: { courier_id }
router.post('/end-work', async (req: Request, res: Response) => {
  const { courier_id } = req.body as { courier_id: string };
  if (!courier_id) {
    res.status(400).json({ success: false, error: 'courier_id is required' });
    return;
  }

  try {
    const result = await endWork(courier_id);
    if (result.success) {
      res.json({ success: true, summary: result.summary });
    } else {
      res.status(409).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error('[Couriers] /end-work error:', err);
    res.status(500).json({ success: false, error: 'Failed to end work' });
  }
});

// â”€â”€ GET /api/couriers/work-summary/today â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Query: ?courier_id=<uuid>
router.get('/work-summary/today', async (req: Request, res: Response) => {
  const courier_id = req.query.courier_id as string | undefined;
  if (!courier_id) {
    res.status(400).json({ success: false, error: 'courier_id is required' });
    return;
  }

  try {
    const summary = await getTodaySummary(courier_id);
    if (!summary) {
      res.status(404).json({ success: false, error: 'Courier not found' });
      return;
    }
    res.json({ success: true, ...summary });
  } catch (err) {
    console.error('[Couriers] /work-summary/today error:', err);
    res.status(500).json({ success: false, error: 'Failed to load work summary' });
  }
});

// â”€â”€ GET /api/couriers/work-summary/history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Query: ?courier_id=<uuid>&year=<YYYY>&month=<1-12> â€” سجل ساعات العمل
router.get('/work-summary/history', async (req: Request, res: Response) => {
  const courier_id = req.query.courier_id as string | undefined;
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);

  if (!courier_id || !year || !month || month < 1 || month > 12) {
    res.status(400).json({ success: false, error: 'courier_id, year and month (1-12) are required' });
    return;
  }

  try {
    const history = await getMonthlyHistory(courier_id, year, month);
    res.json({ success: true, ...history });
  } catch (err) {
    console.error('[Couriers] /work-summary/history error:', err);
    res.status(500).json({ success: false, error: 'Failed to load work history' });
  }
});

export default router;
