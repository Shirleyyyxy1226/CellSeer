/**
 * Public entry-point for the protocol feature. Importing from
 * ``@/features/protocol`` should be the only path UI code needs.
 *
 * The actual dialog is intentionally NOT re-exported here so it stays
 * lazy-loaded via the provider (see ProtocolDialogProvider).
 */

export { AttachProtocolButton } from './AttachProtocolButton';
export { ProtocolStatusChip } from './ProtocolStatusChip';
export { ProtocolDialogProvider } from './ProtocolDialogProvider';
export { useAttachProtocol } from './useAttachProtocol';
export { ProtocolBandPreview } from './ProtocolBandPreview';
export type {
  EditableProtocolSegment,
  OpenEndedProtocolSegment,
  OpenAttachProtocolOptions,
  AttachProtocolScope,
} from './types';
export { parseCRate, formatCRate, formatCycleRange, synthesiseProtocolName } from './cRate';
