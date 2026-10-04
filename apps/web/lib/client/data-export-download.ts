/** 文件来自鉴权 POST 的二进制响应，不能把凭证放入可复制的下载 URL。 */
export function saveDataExportBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; anchor.style.display = "none";
  document.body.append(anchor); anchor.click(); anchor.remove();
  // 浏览器保存流程异步读取 Blob URL；不要在 click 同步返回时撤销。
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
