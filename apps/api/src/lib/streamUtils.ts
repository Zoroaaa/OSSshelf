/**
 * streamUtils.ts
 * 流式响应辅助函数（Cloudflare Workers 环境，不缓冲整包）。
 */

/**
 * 对 ReadableStream 做字节区间截取，用于 Telegram 等不支持 Range 的后端。
 * 只保留 [start, end] 区间（含端点），其余 chunk 直接丢弃，内存占用为单个 chunk。
 */
export function sliceReadableStream(
  body: ReadableStream<Uint8Array>,
  start: number,
  end: number
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let position = 0;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) {
        controller.close();
        return;
      }
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            finished = true;
            controller.close();
            return;
          }
          if (!value || value.length === 0) continue;

          const chunkStart = position;
          const chunkEnd = position + value.length - 1;
          position += value.length;

          if (chunkEnd < start) continue;

          const from = Math.max(0, start - chunkStart);
          const to = Math.min(value.length, end - chunkStart + 1);
          if (to > from) {
            controller.enqueue(value.subarray(from, to));
          }

          if (position > end) {
            finished = true;
            await reader.cancel().catch(() => undefined);
            // 当前 chunk 已入队，下一次 pull 再关闭
            return;
          }
        }
      } catch (error) {
        finished = true;
        controller.error(error);
      }
    },
    cancel(reason) {
      finished = true;
      reader.cancel(reason).catch(() => undefined);
    },
  });
}
