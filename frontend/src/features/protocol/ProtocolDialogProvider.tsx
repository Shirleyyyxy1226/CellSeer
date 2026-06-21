/**
 * Global mount-point for the attach-protocol wizard.
 *
 * Any page that wants to surface "Attach protocol" only needs to call
 * ``useAttachProtocol().open({ cellIds, ... })``. The actual dialog is
 * lazy-rendered here so we don't pay for the wizard subtree until the
 * user invokes it.
 *
 * Keeping the dialog out of per-page React trees means a single instance
 * survives route changes, so wizard state isn't lost if the user opens
 * the dialog on /projects/:id and clicks through to /dashboard.
 */

import * as React from 'react';

import type { OpenAttachProtocolOptions } from './types';
import {
  ProtocolDialogContext,
  type ProtocolDialogContextValue,
} from './protocolDialogContext';

/**
 * Lazy import keeps the dialog module out of the main bundle. The dialog
 * pulls in the segment editor + templates + verify step, which together
 * weigh ~15 KB minified; not worth shipping on every initial paint.
 */
const AttachProtocolDialog = React.lazy(() =>
  import('./AttachProtocolDialog').then((m) => ({ default: m.AttachProtocolDialog })),
);

export function ProtocolDialogProvider({ children }: { children: React.ReactNode }) {
  const [openOptions, setOpenOptions] = React.useState<OpenAttachProtocolOptions | null>(null);

  const open = React.useCallback((options: OpenAttachProtocolOptions) => {
    setOpenOptions(options);
  }, []);

  const close = React.useCallback(() => {
    setOpenOptions(null);
  }, []);

  const value = React.useMemo<ProtocolDialogContextValue>(() => ({ open }), [open]);

  return (
    <ProtocolDialogContext.Provider value={value}>
      {children}
      {openOptions !== null && (
        <React.Suspense fallback={null}>
          <AttachProtocolDialog
            options={openOptions}
            onClose={close}
          />
        </React.Suspense>
      )}
    </ProtocolDialogContext.Provider>
  );
}

