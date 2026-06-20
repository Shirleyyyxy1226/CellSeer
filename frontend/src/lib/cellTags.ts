/**
 * Cell-annotation tag catalog.
 *
 * Tags are saved as plain strings on the per-cell annotation record (see
 * `cellSelectionContext.CellAnnotation.tags`), so their canonical `id` is what
 * gets persisted to `/api/cell-annotation/{cellId}`. The rest of the entry
 * (label, icon, colors, description) is purely presentation + filter wiring.
 *
 * To add a new tag: append a row here.
 */
import {
  Star,
  AlertTriangle,
  XOctagon,
  type LucideIcon,
} from 'lucide-react';

export interface TagConfig {
  /** Canonical persisted id. Keep stable; this is what's stored on the cell. */
  id: string;
  label: string;
  description: string;
  /** Foreground text + icon colour. */
  fg: string;
  /** Background swatch when the chip is active. */
  bg: string;
  /** Outline + soft tint when the chip is inactive (hover preview). */
  outline: string;
  icon: LucideIcon;
}

export const TAG_CATALOG: TagConfig[] = [
  {
    id: 'Star',
    label: 'Star',
    description: 'Best-in-class — flag as a standout result.',
    fg: '#a16207',
    bg: '#fef3c7',
    outline: '#fde68a',
    icon: Star,
  },
  {
    id: 'Anomaly',
    label: 'Anomaly',
    description: 'Unusual behavior — investigate further.',
    fg: '#c2410c',
    bg: '#ffedd5',
    outline: '#fed7aa',
    icon: AlertTriangle,
  },
  {
    id: 'Failed',
    label: 'Failed',
    description: 'Cell failed — kept visible for context.',
    fg: '#b91c1c',
    bg: '#fee2e2',
    outline: '#fecaca',
    icon: XOctagon,
  },
];

const CATALOG_BY_ID = new Map(TAG_CATALOG.map((t) => [t.id, t]));

export function getTagConfig(id: string): TagConfig | undefined {
  return CATALOG_BY_ID.get(id);
}
