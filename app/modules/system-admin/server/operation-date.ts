import { BusinessError, zDate } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { Session } from '@caiwu/server-kit';

// Operation dates belong to a login session. They never alter the system clock or periods.
// The shared session contract can adopt this field later without changing its meaning.
const dates = new WeakMap<Session, string>();
export async function operationDate(svc: CoreServices, session: Session) {
  const book = await svc.book.info();
  const period = String(book.startPeriod);
  const startDate = `${period.slice(0, 4)}-${period.slice(4)}-01`;
  const systemDate = svc.ctx.now().toISOString().slice(0, 10);
  return {
    date: dates.get(session) ?? (systemDate < startDate ? startDate : systemDate),
    systemDate,
    startDate,
  };
}
export async function setOperationDate(svc: CoreServices, session: Session, date: string) {
  const parsed = zDate.safeParse(date);
  if (!parsed.success)
    throw new BusinessError({
      code: 'OPERATION_DATE_INVALID',
      message: '操作日期不是有效的日历日期',
      hint: '请按年、月、日重新选择日期',
    });
  const previous = await operationDate(svc, session);
  if (date < previous.startDate)
    throw new BusinessError({
      code: 'OPERATION_DATE_BEFORE_START',
      message: '操作日期早于账套开账日期',
      hint: `请选择 ${previous.startDate} 或之后的日期`,
    });
  await svc.log.write({
    action: 'system-admin.session.date',
    summary: `操作日期设为 ${date}`,
    detail: { previous: previous.date, date, systemDate: previous.systemDate },
  });
  dates.set(session, date);
  return { ...previous, date };
}
