import { type DebugEvt, debugEvents } from "@better-ccflare/core";

export function createDebugStreamHandler() {
	return (req: Request): Response => {
		let writeHandler: ((data: DebugEvt) => void) | null = null;
		let isClosed = false;

		const stream = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();

				writeHandler = (data: DebugEvt) => {
					if (isClosed) return;

					try {
						const message = `data: ${JSON.stringify(data)}\n\n`;
						controller.enqueue(encoder.encode(message));
					} catch {
						isClosed = true;
						if (writeHandler) {
							debugEvents.off("event", writeHandler);
							writeHandler = null;
						}
					}
				};

				controller.enqueue(encoder.encode("event: connected\ndata: ok\n\n"));
				debugEvents.on("event", writeHandler);
			},
			cancel() {
				isClosed = true;
				if (writeHandler) {
					debugEvents.off("event", writeHandler);
					writeHandler = null;
				}
			},
		});

		req.signal?.addEventListener("abort", () => {
			if (!isClosed && writeHandler) {
				isClosed = true;
				debugEvents.off("event", writeHandler);
				writeHandler = null;
			}
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				Connection: "keep-alive",
				"Cache-Control": "no-cache",
			},
		});
	};
}
