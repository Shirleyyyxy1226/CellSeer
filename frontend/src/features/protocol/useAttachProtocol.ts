/**
 * Public hook for opening the attach-protocol wizard from any surface.
 * See ``ProtocolDialogProvider`` for the mount-point semantics.
 */

import * as React from 'react';

import {
  ProtocolDialogContext,
  type ProtocolDialogContextValue,
} from './protocolDialogContext';

export function useAttachProtocol(): ProtocolDialogContextValue {
  const ctx = React.useContext(ProtocolDialogContext);
  if (!ctx) {
    // Soft-fail outside the provider: clicking does nothing instead of
    // crashing. This keeps the chip safe to render in tests and Storybook
    // setups that haven't mounted the provider.
    return {
      open: () => {
        if (typeof console !== 'undefined') {
          console.warn(
            'useAttachProtocol(): no ProtocolDialogProvider mounted; open() is a no-op',
          );
        }
      },
    };
  }
  return ctx;
}
