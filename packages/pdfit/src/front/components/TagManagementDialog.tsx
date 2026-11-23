import { Dialog, type DialogProps } from '@mui/material';

/** Shared sizing for the single-document and bulk tag dialogs. See docs/usage.md#manage-tags. */
export default function TagManagementDialog({ children, open, onClose }: Pick<DialogProps, 'children' | 'open' | 'onClose'>) {
  return (
    <Dialog open={open} onClose={onClose} disableAutoFocus fullWidth maxWidth={false} PaperProps={{
      sx: {
        width: 'calc(100% - 24px)',
        maxWidth: 720,
        mx: 1.5,
        '& .MuiDialogTitle-root, & .MuiDialogContent-root': { px: { xs: 2, sm: 3 } },
      },
    }}>
      {children}
    </Dialog>
  );
}
