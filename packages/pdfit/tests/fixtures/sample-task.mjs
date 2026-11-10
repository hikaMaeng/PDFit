// Task script used by background-tasks.test.mjs. It follows the standard task
// contract: a default export with run(payload, context).
import { threadId } from 'node:worker_threads';

export default {
  async run(payload, context) {
    if (payload.mode === 'throw') throw new TypeError(`boom ${payload.value}`);
    if (payload.mode === 'hang') await new Promise(() => {});
    if (payload.mode === 'sleep') await new Promise((resolve) => setTimeout(resolve, payload.ms));
    return { echoed: payload.value, type: context.type, key: context.key, threadId };
  },
};
