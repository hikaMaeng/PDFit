import assert from 'node:assert/strict';

export async function startPointerDrag(page, source, { touch = false } = {}) {
  if (touch) await source.tap({ trial: true, timeout: 5000 });
  else await source.click({ trial: true, timeout: 5000 });
  const box = await source.boundingBox();
  assert.ok(box);
  let point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const session = touch ? await page.context().newCDPSession(page) : null;
  const sendTouch = (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
  const move = async (next) => {
    if (touch) await sendTouch('touchMove', [next]);
    else await page.mouse.move(next.x, next.y, { steps: 10 });
    point = next;
  };
  if (touch) await sendTouch('touchStart', [point]);
  else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  }
  await move({ x: point.x, y: point.y + 14 });
  return {
    async over(target) {
      await target.waitFor({ timeout: 5000 });
      await target.scrollIntoViewIfNeeded();
      const targetBox = await target.boundingBox();
      assert.ok(targetBox);
      await move({ x: Math.round(targetBox.x + targetBox.width / 2), y: Math.round(targetBox.y + targetBox.height / 2) });
      if (!touch) await page.mouse.move(point.x, point.y);
    },
    async drop() {
      if (touch) {
        await sendTouch('touchEnd', []);
        await session.detach();
      } else await page.mouse.up();
    },
    async cancel() {
      assert.ok(session, 'touch cancellation uses a real Chromium input event');
      await sendTouch('touchCancel', []);
      await session.detach();
    },
  };
}
