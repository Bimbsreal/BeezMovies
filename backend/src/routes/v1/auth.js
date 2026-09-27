import { Router } from 'express';
import { config } from '../../config/index.js';
import {
  loginAccount,
  logoutSession,
  registerAccount,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  listOwnSessions,
  revokeAllSessions,
  revokeOneSession,
  verifyEmail,
  changePassword,
  deleteAccount,
} from '../../auth/service.js';
import { SESSION_COOKIE } from '../../auth/constants.js';
import { clearSessionCookie, readCookie, setSessionCookie } from '../../auth/cookies.js';
import { clientIp, clientUserAgent } from '../../auth/events.js';
import { developmentOnly } from '../../auth/presenter.js';
import {
  emailSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sessionParamsSchema,
  verifyEmailSchema,
  passwordChangeSchema,
  accountDeleteSchema,
} from '../../auth/schemas.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { privateCache } from '../../middleware/private-cache.js';
import { authAttemptLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';

export const authRouter = Router();

authRouter.use(privateCache);

function requestMeta(req) {
  return {
    ip: clientIp(req),
    userAgent: clientUserAgent(req),
  };
}

function publicAuthPayload(payload, developmentFields) {
  if (config.isProduction) return payload;
  return { ...payload, ...developmentOnly(developmentFields) };
}

authRouter.post(
  '/register',
  authAttemptLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await registerAccount({
      ...req.validated.body,
      ...requestMeta(req),
    });
    res.status(201).json(publicAuthPayload(
      { user: result.user },
      { emailVerificationToken: result.verificationToken },
    ));
  }),
);

authRouter.post(
  '/login',
  authAttemptLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await loginAccount({
      ...req.validated.body,
      ...requestMeta(req),
    });
    setSessionCookie(res, result.sessionToken);
    res.json({
      user: result.user,
      session: {
        id: result.session.id,
        expiresAt: result.session.expiresAt,
      },
    });
  }),
);

authRouter.post('/logout', asyncHandler(async (req, res) => {
  await logoutSession({
    token: readCookie(req, SESSION_COOKIE),
    ...requestMeta(req),
  });
  clearSessionCookie(res);
  res.json({ status: 'ok' });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({
    user: req.auth.user,
    session: req.auth.session,
  });
}));

authRouter.post(
  '/forgot-password',
  authAttemptLimiter,
  validate(emailSchema),
  asyncHandler(async (req, res) => {
    const result = await requestPasswordReset({
      email: req.validated.body.email,
      ...requestMeta(req),
    });
    res.json(publicAuthPayload(
      { status: 'ok' },
      { passwordResetToken: result.token },
    ));
  }),
);

authRouter.post(
  '/reset-password',
  authAttemptLimiter,
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    await resetPassword({
      token: req.validated.body.token,
      password: req.validated.body.password,
      ...requestMeta(req),
    });
    clearSessionCookie(res);
    res.json({ status: 'ok' });
  }),
);

authRouter.post(
  '/verify-email',
  authAttemptLimiter,
  validate(verifyEmailSchema),
  asyncHandler(async (req, res) => {
    const result = await verifyEmail({
      token: req.validated.body.token,
      ...requestMeta(req),
    });
    res.json({ user: result.user });
  }),
);

authRouter.post(
  '/resend-verification',
  authAttemptLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await resendVerification({
      userId: req.auth.user.id,
      ...requestMeta(req),
    });
    res.json(publicAuthPayload(
      { status: 'ok', user: result.user },
      { emailVerificationToken: result.token },
    ));
  }),
);

authRouter.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listOwnSessions(req.auth.user.id, req.auth.session.id) });
}));

authRouter.post('/sessions/revoke-all', requireAuth, asyncHandler(async (req, res) => {
  await revokeAllSessions({
    userId: req.auth.user.id,
    ...requestMeta(req),
  });
  clearSessionCookie(res);
  res.json({ status: 'ok' });
}));

authRouter.post(
  '/sessions/:sessionId/revoke',
  requireAuth,
  validate(sessionParamsSchema),
  asyncHandler(async (req, res) => {
    await revokeOneSession({
      userId: req.auth.user.id,
      sessionId: req.validated.params.sessionId,
      ...requestMeta(req),
    });
    if (req.validated.params.sessionId === req.auth.session.id) {
      clearSessionCookie(res);
    }
    res.json({ status: 'ok' });
  }),
);

authRouter.post(
  '/password',
  requireAuth,
  validate(passwordChangeSchema),
  asyncHandler(async (req, res) => {
    await changePassword({
      userId: req.auth.user.id,
      currentPassword: req.validated.body.currentPassword,
      password: req.validated.body.password,
      ...requestMeta(req),
    });
    clearSessionCookie(res);
    res.json({ status: 'ok' });
  }),
);

authRouter.post(
  '/account/delete',
  requireAuth,
  validate(accountDeleteSchema),
  asyncHandler(async (req, res) => {
    await deleteAccount({
      userId: req.auth.user.id,
      password: req.validated.body.password,
      ...requestMeta(req),
    });
    clearSessionCookie(res);
    res.json({ status: 'ok' });
  }),
);
