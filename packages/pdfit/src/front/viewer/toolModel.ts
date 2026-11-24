import type { AnnotationTool } from '../../common/protocol/annotations/index.js';

export class ViewerToolModel {
  private tool: AnnotationTool = 'select';
  private clipPanelOpen = false;
  private version = 0;
  private readonly listeners = new Set<() => void>();

  getTool = () => this.tool;
  isClipPanelOpen = () => this.clipPanelOpen;
  getVersion = () => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  toggleTool(next: AnnotationTool) {
    if (next === this.tool) {
      this.update('select', next === 'bookmark' ? false : this.clipPanelOpen);
      return;
    }
    this.update(next, next === 'bookmark' || this.clipPanelOpen);
  }

  finishClipSelection = () => {
    if (this.tool === 'bookmark') this.update('select', true);
  };

  closeClipPanel = () => {
    this.update(this.tool === 'bookmark' ? 'select' : this.tool, false);
  };

  private update(tool: AnnotationTool, clipPanelOpen: boolean) {
    if (tool === this.tool && clipPanelOpen === this.clipPanelOpen) return;
    this.tool = tool;
    this.clipPanelOpen = clipPanelOpen;
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }
}
