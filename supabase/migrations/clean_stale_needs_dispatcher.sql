-- One-off cleanup for the "needs_dispatcher" (needs supervisor) flag on
-- batches. Before the fix in server/logistics/driverAssignment.ts, the flag
-- was set to true whenever auto-assignment exhausted all rounds, but was
-- only ever cleared by the admin's manual "change driver" action. Batches
-- that left pending_assignment through any other path (driver accepting
-- normally via /accept, on_route driver taking a next mission, or a
-- breakdown cancellation) kept the flag stuck forever, even after being
-- assigned/completed/cancelled.
--
-- A batch only genuinely "needs a dispatcher" while it's still
-- pending_assignment. Anything else (assigned, in_transit, completed,
-- cancelled) has already been resolved one way or another.

update public.batches
set needs_dispatcher = false
where needs_dispatcher = true
  and status <> 'pending_assignment';
