'use client';

import { ChevronLeft, ChevronRight, ListFilter, Plus, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SyncBadge } from '@/components/common/states';
import type { Goal } from '@/lib/data/goals';
import {
  EMPTY_FILTER,
  isFilterActive,
  type ItemFilter,
} from '@/lib/domain/calendar';
import { CALENDAR_VIEWS, VIEW_LABELS, type CalendarView } from '@/lib/domain/calendar-range';
import { CATEGORY_META, CATEGORY_ORDER, TASK_STATUS_META } from '@/lib/domain/vocabulary';
import type { CalendarItemStatus } from '@/lib/domain/calendar';
import type { CategoryKind, TaskPriority } from '@/lib/types/database';
import { cn } from '@/lib/utils';

/**
 * The calendar's controls.
 *
 * The filter is a plain description of the *view*, never of the data: filtering
 * hides items from the grids and the agenda, and nothing else in the app sees
 * it. That matters — a filter that quietly reduced what got counted in insights
 * would make every chart lie.
 */

const STATUS_ORDER: CalendarItemStatus[] = [
  'planned',
  'in_progress',
  'completed',
  'missed',
  'skipped',
  'cancelled',
];

const PRIORITY_ORDER: Array<{ value: TaskPriority; label: string }> = [
  { value: 'main', label: 'MAIN' },
  { value: 'secondary', label: 'Secondary' },
];

export interface CalendarToolbarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  today: boolean;
  filter: ItemFilter;
  onFilterChange: (filter: ItemFilter) => void;
  goals: Goal[];
  sync: 'idle' | 'connecting' | 'live' | 'unavailable';
  loading: boolean;
  onQuickAdd: () => void;
}

export function CalendarToolbar({
  view,
  onViewChange,
  label,
  onPrev,
  onNext,
  onToday,
  today,
  filter,
  onFilterChange,
  goals,
  sync,
  loading,
  onQuickAdd,
}: CalendarToolbarProps) {
  const active = isFilterActive(filter);

  function toggle(key: 'kinds' | 'categories' | 'priorities' | 'statuses' | 'goalIds', value: string) {
    // One branch per list: a computed key over a union would not type-check, and
    // this keeps each list's element type honest at the call site.
    switch (key) {
      case 'kinds':
        onFilterChange({ ...filter, kinds: toggleInList(filter.kinds, value as 'task' | 'event') });
        return;
      case 'categories':
        onFilterChange({
          ...filter,
          categories: toggleInList<CategoryKind>(filter.categories, value as CategoryKind),
        });
        return;
      case 'priorities':
        onFilterChange({
          ...filter,
          priorities: toggleInList<TaskPriority>(filter.priorities, value as TaskPriority),
        });
        return;
      case 'statuses':
        onFilterChange({
          ...filter,
          statuses: toggleInList<CalendarItemStatus>(filter.statuses, value as CalendarItemStatus),
        });
        return;
      case 'goalIds':
        onFilterChange({ ...filter, goalIds: toggleInList(filter.goalIds, value) });
        return;
    }
  }

  const activeCount =
    filter.kinds.length +
    filter.categories.length +
    filter.priorities.length +
    filter.statuses.length +
    filter.goalIds.length +
    (filter.query.trim().length > 0 ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* View switch — a real segmented control, not a dropdown, so the shape
            of the view is visible before it is clicked. */}
        <div
          role="group"
          aria-label="Calendar view"
          className="flex items-center rounded-md border border-border bg-surface p-0.5"
        >
          {CALENDAR_VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onViewChange(option)}
              aria-pressed={view === option}
              className={cn(
                'min-h-8 rounded px-3 text-xs transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === option
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {VIEW_LABELS[option]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={onPrev} aria-label={`Previous ${VIEW_LABELS[view].toLowerCase()}`}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" onClick={onToday} disabled={today}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" onClick={onNext} aria-label={`Next ${VIEW_LABELS[view].toLowerCase()}`}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <p aria-live="polite" className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {label}
        </p>

        <div className="flex items-center gap-2">
          <SyncBadge status={sync} />
          {loading ? (
            <span className="text-2xs text-muted-foreground" role="status">
              Loading…
            </span>
          ) : null}
          <Button size="sm" onClick={onQuickAdd}>
            <Plus className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Add</span>
            <span className="sr-only sm:hidden">Add something</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={filter.query}
            onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
            placeholder="Search titles, notes, places"
            aria-label="Search the calendar"
            className="pl-8"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ListFilter className="size-4" aria-hidden="true" />
              Filters
              {activeCount > 0 ? (
                <Badge variant="gold" className="tabular-nums">
                  {activeCount}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[70dvh] w-80 overflow-y-auto p-0">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-medium">Show only</p>
              <Button
                variant="ghost"
                size="sm"
                disabled={!active}
                onClick={() => onFilterChange({ ...EMPTY_FILTER })}
              >
                <X className="size-3.5" aria-hidden="true" />
                Clear
              </Button>
            </div>

            <div className="divide-y divide-border">
              <FilterGroup title="Kind">
                <FilterRow
                  id="filter-kind-task"
                  label="Tasks"
                  checked={filter.kinds.includes('task')}
                  onChange={() => toggle('kinds', 'task')}
                />
                <FilterRow
                  id="filter-kind-event"
                  label="Events"
                  checked={filter.kinds.includes('event')}
                  onChange={() => toggle('kinds', 'event')}
                />
              </FilterGroup>

              <FilterGroup title="Priority">
                {PRIORITY_ORDER.map((option) => (
                  <FilterRow
                    key={option.value}
                    id={`filter-priority-${option.value}`}
                    label={option.label}
                    checked={filter.priorities.includes(option.value)}
                    onChange={() => toggle('priorities', option.value)}
                  />
                ))}
              </FilterGroup>

              <FilterGroup title="Status">
                {STATUS_ORDER.map((status) => (
                  <FilterRow
                    key={status}
                    id={`filter-status-${status}`}
                    label={TASK_STATUS_META[status].label}
                    checked={filter.statuses.includes(status)}
                    onChange={() => toggle('statuses', status)}
                  />
                ))}
              </FilterGroup>

              <FilterGroup title="Category">
                {CATEGORY_ORDER.map((category: CategoryKind) => (
                  <FilterRow
                    key={category}
                    id={`filter-category-${category}`}
                    label={CATEGORY_META[category].label}
                    checked={filter.categories.includes(category)}
                    onChange={() => toggle('categories', category)}
                  />
                ))}
              </FilterGroup>

              {goals.length > 0 ? (
                <FilterGroup title="Goal">
                  {goals.map((goal) => (
                    <FilterRow
                      key={goal.id}
                      id={`filter-goal-${goal.id}`}
                      label={goal.title}
                      checked={filter.goalIds.includes(goal.id)}
                      onChange={() => toggle('goalIds', goal.id)}
                    />
                  ))}
                </FilterGroup>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>

        {active ? (
          <Button variant="ghost" size="sm" onClick={() => onFilterChange({ ...EMPTY_FILTER })}>
            <X className="size-3.5" aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>

      {active ? (
        <p className="text-2xs leading-relaxed text-muted-foreground">
          Filters change what this screen shows. Your records, your totals and your insights are untouched.
        </p>
      ) : null}
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="px-3 py-2">
      <legend className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </legend>
      <div className="space-y-1">{children}</div>
    </fieldset>
  );
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function FilterRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-xs font-normal">
        {label}
      </Label>
    </div>
  );
}
