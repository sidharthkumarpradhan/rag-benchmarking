import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function MetricCard({ title, value, unit, subtitle, trend, color = 'blue', icon: Icon }) {
  const colorMap = {
    blue: 'from-blue-500/10 to-blue-600/5 border-blue-200',
    emerald: 'from-emerald-500/10 to-emerald-600/5 border-emerald-200',
    purple: 'from-purple-500/10 to-purple-600/5 border-purple-200',
    amber: 'from-amber-500/10 to-amber-600/5 border-amber-200',
    rose: 'from-rose-500/10 to-rose-600/5 border-rose-200',
  };
  const iconColor = {
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
    purple: 'text-purple-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
  };

  return (
    <div className={cn(
      'rounded-2xl border bg-gradient-to-br p-5 relative overflow-hidden',
      colorMap[color] || colorMap.blue
    )}>
      {Icon && (
        <div className={cn('absolute top-4 right-4 opacity-20', iconColor[color])}>
          <Icon className="w-12 h-12" />
        </div>
      )}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        <div className="mt-1.5 flex items-baseline gap-1">
          <span className="text-3xl font-bold text-foreground">{value ?? '—'}</span>
          {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        {trend !== undefined && (
          <div className={cn(
            'flex items-center gap-1 mt-2 text-xs font-medium',
            trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-rose-500' : 'text-muted-foreground'
          )}>
            {trend > 0 ? <TrendingUp className="w-3 h-3" /> :
              trend < 0 ? <TrendingDown className="w-3 h-3" /> :
                <Minus className="w-3 h-3" />}
            {Math.abs(trend)}% vs avg
          </div>
        )}
      </div>
    </div>
  );
}