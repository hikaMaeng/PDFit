export interface ViewerSessionState {
  uiHidden: boolean;
  inverted: boolean;
}
export type ViewerSessionEvent =
  | { type: 'setUiHidden'; value: boolean }
  | { type: 'toggleUi' }
  | { type: 'setInverted'; value: boolean }
  | { type: 'toggleInverted' };

export interface ViewerGridBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function isPointInViewerCenterGrid(
  clientX: number,
  clientY: number,
  bounds: ViewerGridBounds,
): boolean {
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const x = clientX - bounds.left;
  const y = clientY - bounds.top;
  return x >= bounds.width / 3
    && x < bounds.width * 2 / 3
    && y >= bounds.height / 3
    && y < bounds.height * 2 / 3;
}

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
    if (event.type === 'toggleUi') next.uiHidden = !next.uiHidden;
    if (event.type === 'setUiHidden') next.uiHidden = event.value;
    if (event.type === 'toggleInverted') next.inverted = !next.inverted;
    if (event.type === 'setInverted') next.inverted = event.value;
    if (next.uiHidden === this.state.uiHidden && next.inverted === this.state.inverted) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}
