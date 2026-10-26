import { queryClient, sessionStore } from '@caiwu/web-kit';

/** 撤销请求并清空所有用户数据，重新加载还会销毁壳的旧标签页与菜单。 */
export async function goToLogin(bookId: string) {
  await queryClient.cancelQueries();
  sessionStore.set(null);
  queryClient.clear();
  window.location.replace(`/login/${encodeURIComponent(bookId)}`);
}

export async function saveFile(file: { filename: string; mime: string; content: string }) {
  const blob = new Blob([file.content], { type: file.mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
