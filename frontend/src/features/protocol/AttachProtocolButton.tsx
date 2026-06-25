/**
 * Universal "Attach protocol" entry-point button. Drop this anywhere we
 * want a callable: cell drawer, multi-select toolbar, master plot empty
 * state, etc. It owns no UI state — it just calls into the provider.
 */

import * as React from 'react';
import { ListChecks } from 'lucide-react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { useAttachProtocol } from './useAttachProtocol';
import type { OpenAttachProtocolOptions } from './types';

export interface AttachProtocolButtonProps
  extends Omit<ButtonProps, 'onClick' | 'children'> {
  /** Pre-fill the wizard scope and/or seed segments. */
  prefill?: OpenAttachProtocolOptions;
  /** Label override (default: "Attach protocol"). */
  label?: React.ReactNode;
  /** Hide the icon when used inside dense toolbars. */
  hideIcon?: boolean;
}

export function AttachProtocolButton({
  prefill,
  label = 'Attach protocol',
  hideIcon = false,
  variant = 'outline',
  size = 'sm',
  ...rest
}: AttachProtocolButtonProps) {
  const { open } = useAttachProtocol();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => open(prefill ?? {})}
      {...rest}
    >
      {!hideIcon && <ListChecks className="h-4 w-4" />}
      <span>{label}</span>
    </Button>
  );
}
