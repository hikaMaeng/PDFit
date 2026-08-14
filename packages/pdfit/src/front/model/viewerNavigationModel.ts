class ViewerNavigationModel {
  private requestedPage: number | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();

  getRequestedPage = () => this.requestedPage;
  getSnapshot = () => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  requestPage(page: number | null | undefined) {
    if (page == null || this.requestedPage === page) return;
    this.requestedPage = page;
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }
}

const models = new Map<string, ViewerNavigationModel>();

export function getViewerNavigationModel(folder: string, filename: string) {
  const key = `${folder}\u0000${filename}`;
  let model = models.get(key);
  if (!model) {
    model = new ViewerNavigationModel();
    models.set(key, model);
  }
  return model;
}
