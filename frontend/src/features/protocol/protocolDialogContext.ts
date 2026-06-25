/**
 * Shared React context for the attach-protocol wizard. Split out from the
 * provider so the hook and the component can each live in their own file
 * (react-refresh's exhaustive-exports rule requires this).
 */

import * as React from 'react';

import type { OpenAttachProtocolOptions } from './types';

export interface ProtocolDialogContextValue {
  /** Open the wizard. ``cellIds`` may be empty — the scope step handles it. */
  open: (options: OpenAttachProtocolOptions) => void;
}

export const ProtocolDialogContext = React.createContext<ProtocolDialogContextValue | null>(null);
