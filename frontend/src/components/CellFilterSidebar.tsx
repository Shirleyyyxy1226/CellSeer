import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type SidebarTab = 'dqdv' | 'dvdq' | 'rateperf-hier' | 'voltagecap';

interface CellFilterSidebarProps {
  visibleCells: string[];
  onToggleCell: (cellId: string) => void;
  cathodeFilter: string;
  onCathodeFilter: (v: string) => void;
  spacerFilter: string;
  onSpacerFilter: (v: string) => void;
  separatorFilter: string;
  onSeparatorFilter: (v: string) => void;
  activeTab?: SidebarTab;
  onNavigateToTab?: (tab: SidebarTab) => void;
}

interface CellMetadata {
  id: string;
  name: string;
  cathode: string;
  spacer: string;
  separator: string;
  color: string;
}

const CELL_METADATA: CellMetadata[] = [
  { id: 'cellA', name: 'Cell A', cathode: 'NMC811', spacer: 'Steel', separator: 'Celgard', color: '#FFB300' },
  { id: 'cellB', name: 'Cell B', cathode: 'NMC811', spacer: 'Copper', separator: 'Ceramic', color: '#1E88E5' },
  { id: 'cellC', name: 'Cell C', cathode: 'NMC622', spacer: 'Steel', separator: 'Celgard', color: '#43A047' },
  { id: 'cellD', name: 'Cell D', cathode: 'NMC622', spacer: 'Copper', separator: 'Ceramic', color: '#E53935' },
  { id: 'cellE', name: 'Cell E', cathode: 'LFP', spacer: 'Steel', separator: 'Celgard', color: '#8E24AA' },
  { id: 'cellF', name: 'Cell F', cathode: 'LFP', spacer: 'Copper', separator: 'Ceramic', color: '#00ACC1' },
  { id: 'cellG', name: 'Cell G', cathode: 'NMC811', spacer: 'Steel', separator: 'Celgard', color: '#F9A825' },
  { id: 'cellH', name: 'Cell H', cathode: 'NMC811', spacer: 'Copper', separator: 'Ceramic', color: '#5C6BC0' },
  { id: 'cellI', name: 'Cell I', cathode: 'NMC622', spacer: 'Steel', separator: 'Celgard', color: '#66BB6A' },
  { id: 'cellJ', name: 'Cell J', cathode: 'NMC622', spacer: 'Copper', separator: 'Ceramic', color: '#EF5350' },
  { id: 'cellK', name: 'Cell K', cathode: 'LFP', spacer: 'Steel', separator: 'Celgard', color: '#AB47BC' },
  { id: 'cellL', name: 'Cell L', cathode: 'LFP', spacer: 'Copper', separator: 'Ceramic', color: '#26C6DA' },
  { id: 'cellM', name: 'Cell M', cathode: 'NMC811', spacer: 'Copper', separator: 'Celgard', color: '#42A5F5' },
  { id: 'cellN', name: 'Cell N', cathode: 'NMC622', spacer: 'Steel', separator: 'Ceramic', color: '#7CB342' },
  { id: 'cellO', name: 'Cell O', cathode: 'LFP', spacer: 'Copper', separator: 'Celgard', color: '#7E57C2' },
  { id: 'cellP', name: 'Cell P', cathode: 'NMC811', spacer: 'Steel', separator: 'Ceramic', color: '#FF7043' },
  { id: 'cellQ', name: 'Cell Q', cathode: 'LFP', spacer: 'Steel', separator: 'Ceramic', color: '#EC407A' },
  { id: 'cellR', name: 'Cell R', cathode: 'NMC622', spacer: 'Copper', separator: 'Celgard', color: '#26A69A' },
];

const cathodes = ['All', ...Array.from(new Set(CELL_METADATA.map((c) => c.cathode)))];
const spacers = ['All', ...Array.from(new Set(CELL_METADATA.map((c) => c.spacer)))];
const separators = ['All', ...Array.from(new Set(CELL_METADATA.map((c) => c.separator)))];

const CHART_LINKS: { key: SidebarTab; label: string }[] = [
  { key: 'dqdv', label: 'dQ/dV 3D' },
  { key: 'dvdq', label: 'dV/dQ 3D' },
  { key: 'rateperf-hier', label: 'Rate Performance' },
  { key: 'voltagecap', label: 'GCD Plot' },
];

const CellFilterSidebar = ({
  visibleCells,
  onToggleCell,
  cathodeFilter,
  onCathodeFilter,
  spacerFilter,
  onSpacerFilter,
  separatorFilter,
  onSeparatorFilter,
  activeTab,
  onNavigateToTab,
}: CellFilterSidebarProps) => {
  const filteredCells = CELL_METADATA.filter((cell) => {
    if (cathodeFilter !== 'All' && cell.cathode !== cathodeFilter) return false;
    if (spacerFilter !== 'All' && cell.spacer !== spacerFilter) return false;
    if (separatorFilter !== 'All' && cell.separator !== separatorFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {onNavigateToTab && (
        <>
          <h3 className="text-sm font-semibold text-foreground">Charts</h3>
          <div className="flex flex-col gap-1">
            {CHART_LINKS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onNavigateToTab(key)}
                className={`text-left px-2 py-1.5 text-sm rounded-md transition-colors ${
                  activeTab === key
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Separator />
        </>
      )}
      <h3 className="text-sm font-semibold text-foreground">Filters</h3>

      {/* Filter dropdowns */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Cathode</Label>
          <Select value={cathodeFilter} onValueChange={onCathodeFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cathodes.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Spacer</Label>
          <Select value={spacerFilter} onValueChange={onSpacerFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {spacers.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Separator</Label>
          <Select value={separatorFilter} onValueChange={onSeparatorFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {separators.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      {/* Cell checkboxes */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">Cells</h3>
        <div className="space-y-2">
          {filteredCells.map((cell) => (
            <div key={cell.id} className="flex items-center gap-2">
              <Checkbox
                id={cell.id}
                checked={visibleCells.includes(cell.id)}
                onCheckedChange={() => onToggleCell(cell.id)}
              />
              <label
                htmlFor={cell.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: cell.color }}
                />
                <span className="text-foreground">{cell.name}</span>
                <span className="text-xs text-muted-foreground">
                  {cell.cathode}
                </span>
              </label>
            </div>
          ))}
          {filteredCells.length === 0 && (
            <p className="text-xs text-muted-foreground">No cells match filters</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CellFilterSidebar;
