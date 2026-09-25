import { userRoleEnum } from '@shared/schema';
import { z } from 'zod';

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({ id: z.number(), username: z.string(), role: z.enum(userRoleEnum.enumValues),
    firstName: z.string(), lastName: z.string(), email: z.string(),mfaRequired:z.boolean().optional(),
    department: z.string().nullish(), avatar: z.string().nullish(), employeeType: z.string().optional() }),
});
export function parseAuthResponse(data: unknown) {
  const parsed = authResponseSchema.parse(data);
  return { token: parsed.accessToken, user: { ...parsed.user, userId: parsed.user.id,
    department: parsed.user.department ?? undefined, avatar: parsed.user.avatar ?? undefined } };
}
