/** Saves `text` as a .txt download through a temporary object URL. */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  // Firefox only follows a click on a link that is in the document.
  document.body.append(link);
  link.click();
  link.remove();
  // The download reads the URL asynchronously (Safari in particular), so revoke it a moment later.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
