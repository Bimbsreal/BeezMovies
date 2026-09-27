import { AppError } from '../errors/app-error.js';
import { blocksPublicRequest, maintenanceState } from '../ops/flags.js';

export async function maintenanceGate(req, res, next) {
  try {
    const state = await maintenanceState();
    const path = req.path || '/';
    if (blocksPublicRequest(path, state.enabled)) {
      res.set('Cache-Control', 'no-store');
      next(new AppError(state.message, { status: 503, code: 'MAINTENANCE' }));
      return;
    }
  } catch {
    // A settings read must not take the public site offline.
  }
  next();
}
