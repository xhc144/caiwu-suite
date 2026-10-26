export type UnsavedChoice = 'save' | 'discard' | 'cancel';
/** 只有成功保存或明确放弃才切换；保存失败仍留在当前定义。 */
export async function continueAfterEdit(
  dirty: boolean,
  choose: () => Promise<UnsavedChoice>,
  save: () => Promise<boolean>,
  next: () => void,
): Promise<void> {
  if (!dirty) {
    next();
    return;
  }
  const choice = await choose();
  if (choice === 'cancel') return;
  if (choice === 'save' && !(await save())) return;
  next();
}
