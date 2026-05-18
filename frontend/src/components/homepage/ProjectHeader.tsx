import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ProjectHeader() {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">CellSeer</h1>
        <p className="mt-1 text-sm text-muted-foreground">Upload your data to get started</p>
      </div>
      <Button variant="outline" asChild>
        <Link to="/dashboard">
          Dashboard <ArrowRight className="ml-1 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
