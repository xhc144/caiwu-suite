import { createHmac, randomBytes } from 'node:crypto';
import type { ServiceContext } from './context';

// Stable runtime registrations own their key. No user, book, or callback capability is cached.
const keys = new WeakMap<object, Buffer>();
export async function confirmationFingerprint(
  ctx: ServiceContext,
  kind: string,
  payload: unknown,
): Promise<string> {
  const runtime = ctx.providers ?? ctx.modules;
  let key = keys.get(runtime);
  if (!key) keys.set(runtime, (key = randomBytes(32)));
  const book = await ctx.db
    .selectFrom('book_info')
    .select('book_id')
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
  return createHmac('sha256', key)
    .update(
      JSON.stringify({
        bookId: book.book_id,
        userId: ctx.user.id,
        moduleId: ctx.moduleId,
        kind,
        payload,
      }),
    )
    .digest('hex');
}
