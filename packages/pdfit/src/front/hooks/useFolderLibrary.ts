import { useEffect, useSyncExternalStore } from 'react';
import { folderLibraryModel } from '../model/folderLibraryModel';

export function useFolderLibrary(folderName: string) {
  const model = folderLibraryModel.get(folderName);
  const version = useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);

  useEffect(() => {
    void model.ensure();
  }, [model, version]);

  return model.state;
}
