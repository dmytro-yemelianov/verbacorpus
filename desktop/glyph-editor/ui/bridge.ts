declare global {
  interface Window {
    webkit?: {
      messageHandlers: {
        glyphEditor: { postMessage: (value: string) => void };
      };
    };
    __glyphReply: (reply: {
      id: number;
      ok: boolean;
      value?: unknown;
      error?: string;
    }) => void;
    glyphEditorFlush?: () => Promise<void>;
    glyphEditorClipboardAction?: (action: string) => Promise<boolean>;
    glyphEditorAction?: (action: string) => Promise<void>;
  }
}
let serial = 0;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
window.__glyphReply = (reply) => {
  const item = pending.get(reply.id);
  if (!item) return;
  pending.delete(reply.id);
  clearTimeout(item.timer);
  if (reply.ok) item.resolve(reply.value);
  else item.reject(new Error(reply.error ?? "Помилка збереження"));
};
export async function native<T>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!window.webkit?.messageHandlers.glyphEditor) {
    const response = await fetch("/bridge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, args }),
    });
    const reply = await response.json();
    if (!reply.ok)
      throw new Error(reply.error ?? "Локальний сервіс недоступний");
    return reply.value as T;
  }
  return new Promise<T>((resolve, reject) => {
    const id = ++serial,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Немає відповіді від файлового сервісу"));
      }, 30000);
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    window.webkit!.messageHandlers.glyphEditor.postMessage(
      JSON.stringify({ id, action, args }),
    );
  });
}
