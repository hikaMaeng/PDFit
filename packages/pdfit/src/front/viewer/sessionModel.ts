export interface ViewerSessionState {
  uiHidden: boolean;
  inverted: boolean;
}
export type ViewerSessionEvent =
  | { type: 'setInverted'; value: boolean }
  | { type: 'toggleInverted' };

export class ViewerSessionModel {
  private state: ViewerSessionState;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Partial<ViewerSessionState> = {}) {
    this.state = {
      uiHidden: initial.uiHidden ?? false,
      inverted: initial.inverted ?? false,
    };
  }

  getState = (): ViewerSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch(event: ViewerSessionEvent): void {
    const next = { ...this.state };
    if (event.type === 'toggleInverted') next.inverted = !next.inverted;
    if (event.type === 'setInverted') next.inverted = event.value;
    if (next.uiHidden === this.state.uiHidden && next.inverted === this.state.inverted) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}
