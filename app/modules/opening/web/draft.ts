/** 保存失败必须停留；离开决策只有明确放弃或保存成功后才能继续。 */
export async function resolveLeave(
  choice: 'save' | 'discard' | 'cancel',
  save: () => Promise<boolean>,
  leave: () => void,
) {
  if (choice === 'cancel') return false;
  if (choice === 'save' && !(await save())) return false;
  leave();
  return true;
}
