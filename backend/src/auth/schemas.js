import { z } from 'zod';

const email = z.string().trim().email().max(254);
const password = z.string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/[0-9]/, 'Password must include a number');
const displayName = z.string().trim().min(1).max(80);
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/).optional();

export const registerSchema = z.object({
  body: z.object({
    email,
    password,
    displayName,
    username,
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const loginSchema = z.object({
  body: z.object({
    email,
    password: z.string().min(1).max(128),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const emailSchema = z.object({
  body: z.object({ email }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(20).max(200),
    password,
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const verifyEmailSchema = z.object({
  body: z.object({
    token: z.string().min(20).max(200),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const sessionParamsSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({
    sessionId: z.string().uuid(),
  }),
});

export const passwordChangeSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1).max(128),
    password,
    confirm: z.literal(true),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const accountDeleteSchema = z.object({
  body: z.object({
    password: z.string().min(1).max(128),
    confirm: z.literal(true),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});
