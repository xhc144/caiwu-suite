/** React Router 将尾斜杠视为同一路由；查询参数不参与标签身份。 */
export function tabPath(pathname: string) {
  return pathname.replace(/\/+$/, '') || '/';
}
