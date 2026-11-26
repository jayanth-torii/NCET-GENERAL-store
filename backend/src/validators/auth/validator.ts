import { z } from 'zod';

export const LoginBody = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(50),
  password: z.string().min(1, 'Enter your password').max(128),
  counterId: z.coerce.number().int().positive().nullable().optional(),
});
