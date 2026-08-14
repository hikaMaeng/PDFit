// see docs/internals.md#cross-window-message-router

const LOCAL_EVENT_NAME = 'pdfit-window-sync';
const CHANNEL_NAME = 'pdfit-window-sync';
const STORAGE_KEY = 'pdfit.window-sync.v1';
const MAX_SEEN_MESSAGE_IDS = 256;

export interface WindowSyncMessage<TPayload = unknown> {
  id: string;
  topic: string;
  payload: TPayload;
}

type WindowSyncHandler = (payload: unknown) => void;

function isWindowSyncMessage(value: unknown): value is WindowSyncMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<WindowSyncMessage>;
  return typeof message.id === 'string' && typeof message.topic === 'string' && 'payload' in message;
}

class WindowSyncRouter {
  private readonly handlers = new Map<string, Set<WindowSyncHandler>>();
  private readonly seenIds = new Set<string>();
  private channel: BroadcastChannel | null = null;
  private listening = false;

  publish<TPayload>(topic: string, payload: TPayload) {
    const message: WindowSyncMessage<TPayload> = {
      id: `${Date.now()}-${Math.random()}`,
      topic,
      payload,
    };
    this.ensureTransport();
    this.receive(message);
    this.channel?.postMessage(message);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
    } catch {
      // The local router and BroadcastChannel still deliver where available.
    }
  }

  subscribe<TPayload>(topic: string, handler: (payload: TPayload) => void) {
    this.ensureTransport();
    const handlers = this.handlers.get(topic) ?? new Set<WindowSyncHandler>();
    const routedHandler: WindowSyncHandler = (payload) => handler(payload as TPayload);
    handlers.add(routedHandler);
    this.handlers.set(topic, handlers);
    return () => {
      handlers.delete(routedHandler);
      if (handlers.size === 0) this.handlers.delete(topic);
    };
  }

  private ensureTransport() {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener(LOCAL_EVENT_NAME, this.onLocalEvent);
    window.addEventListener('storage', this.onStorage);
    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.addEventListener('message', this.onChannelMessage);
    } catch {
      this.channel = null;
    }
  }

  private receive(value: unknown) {
    if (!isWindowSyncMessage(value) || this.seenIds.has(value.id)) return;
    this.seenIds.add(value.id);
    if (this.seenIds.size > MAX_SEEN_MESSAGE_IDS) this.seenIds.delete(this.seenIds.values().next().value as string);
    for (const handler of this.handlers.get(value.topic) ?? []) handler(value.payload);
  }

  private onLocalEvent = (event: Event) => this.receive((event as CustomEvent<WindowSyncMessage>).detail);

  private onChannelMessage = (event: MessageEvent) => this.receive(event.data);

  private onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      this.receive(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed values written by an older page.
    }
  };
}

const router = new WindowSyncRouter();

export function publishWindowSyncMessage<TPayload>(topic: string, payload: TPayload) {
  router.publish(topic, payload);
}

export function subscribeWindowSyncMessage<TPayload>(topic: string, handler: (payload: TPayload) => void) {
  return router.subscribe(topic, handler);
}
