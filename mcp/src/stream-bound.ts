/**
 * Wraps a response body so that it ends no later than `maxMs` after it starts.
 *
 * Vercel kills an invocation at its maximum duration (300 s by default) and logs
 * "Task timed out". The MCP SDK keeps some SSE bodies open for as long as the client
 * stays connected, so without a bound every such request runs to the kill. The
 * wrapper passes chunks through untouched and, if the source is still open when the
 * timer fires, closes the body cleanly and cancels the source.
 */
export function boundStream(
  source: ReadableStream<Uint8Array>,
  maxMs: number,
  onTimeout?: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = (end: () => void) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        end();
      };

      timer = setTimeout(() => {
        if (finished) return;
        onTimeout?.();
        finish(() => controller.close());
        reader.cancel(new Error(`response stream exceeded ${maxMs}ms`)).catch(() => {});
      }, maxMs);

      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (finished) return;
            if (done) break;
            controller.enqueue(value);
          }
          finish(() => controller.close());
        } catch (err) {
          finish(() => controller.error(err));
        }
      })();
    },
    cancel(reason) {
      finished = true;
      clearTimeout(timer);
      return reader.cancel(reason);
    },
  });
}
