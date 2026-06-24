/**
 * Active colour-ramp context.
 *
 * The orchestrator owns the chosen ramp id (deep-linked via `mpRamp`) and wraps
 * the metric-driven views in this provider with the resolved ramp array. Views
 * and legends read it with `useActiveRamp()` and colour via
 * `rampColourFrom(activeRamp, t)` / `rampTextFrom(activeRamp, t)`, so swapping
 * the picker recolours every tile/treemap/legend without prop-drilling. The
 * default value is the registry default (viridis) — so a view rendered outside
 * a provider is unchanged.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { RAMP } from './colours';

const RampContext = createContext<readonly string[]>(RAMP);

export function RampProvider({
  ramp,
  children,
}: {
  ramp: readonly string[];
  children: ReactNode;
}) {
  return <RampContext.Provider value={ramp}>{children}</RampContext.Provider>;
}

/** The active ramp array (defaults to the registry default ramp). */
// eslint-disable-next-line react-refresh/only-export-components
export function useActiveRamp(): readonly string[] {
  return useContext(RampContext);
}
