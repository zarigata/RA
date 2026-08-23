// .anubis/plugins/notify.ts — OS notifications on session events
type AnyCtx = Record<string, unknown>;

async function notify(title: string, message: string, shell: AnyCtx["__shell"] & { $?: { raw: (strings: TemplateStringsArray, ...values: unknown[]) => unknown } }) {
  const $ = shell?.$;
  if (!$) return;
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      await $`osascript -e ${`display notification "${message}" with title "${title}"`}`;
    } else if (platform === "linux") {
      await $`notify-send ${title} ${message}`;
    }
  } catch {
    /* no-op */
  }
}

export const NotifyPlugin = async (ctx: AnyCtx) => {
  return {
    event: async (evt: { event: { type: string } }) => {
      if (evt.event.type === "session.idle") {
        await notify("Anubis", "Session complete", ctx as never);
      }
      if (evt.event.type === "session.error") {
        await notify("Anubis", "Session error", ctx as never);
      }
    },
  };
};

export default NotifyPlugin;
