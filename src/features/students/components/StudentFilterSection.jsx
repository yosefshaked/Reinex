import React, { useState, useMemo } from 'react';
import { ChevronDown, Search, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import DayOfWeekSelect from '@/components/ui/DayOfWeekSelect.jsx';
import { STUDENT_SORT_OPTIONS } from '@/features/students/utils/sorting.js';

export function StudentFilterSection({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  dayFilter,
  onDayChange,
  instructorFilterId,
  onInstructorFilterChange,
  tagFilter,
  onTagFilterChange,
  sortBy,
  onSortChange,
  instructors = [],
  tags = [],
  hasActiveFilters,
  onResetFilters,
  showInstructorFilter = true, // Allow hiding instructor filter for non-admin views
  showStatusFilter = true, // Allow hiding status filter when instructors can't view inactive
  showMyStudentsOption = false, // Show 'My Students' option in instructor dropdown for admin instructors
  currentUserId = null, // Current user ID for 'My Students' option
}) {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const hasAdvancedFilters = useMemo(() => {
    return dayFilter !== null || (showInstructorFilter && instructorFilterId !== null && instructorFilterId !== '') || (showStatusFilter && statusFilter !== 'active') || (tagFilter !== null && tagFilter !== '');
  }, [dayFilter, instructorFilterId, statusFilter, tagFilter, showInstructorFilter, showStatusFilter]);

  return (
    <div className="space-y-sm">
      {/* Search Box with Collapsible Advanced Filters - matching NewSessionForm design */}
      <div className="space-y-2 p-3 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-medium text-neutral-600 text-right">🔍 חיפוש</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="gap-2 text-sm"
          >
            <span>סינון מתקדם</span>
            <ChevronDown 
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                showAdvancedFilters && "rotate-180"
              )}
            />
            {hasAdvancedFilters && !showAdvancedFilters && (
              <span className="inline-flex h-2 w-2 rounded-full bg-primary" title="יש מסננים פעילים" />
            )}
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
          <Input
            type="text"
            placeholder="חיפוש לפי שם, טלפון, תעודת זהות..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pr-9 text-right"
            dir="rtl"
          />
        </div>

        {/* Advanced Filters - Collapsible within search box */}
        {showAdvancedFilters && (
          <div className="pt-2 border-t border-neutral-200 animate-in fade-in slide-in-from-top-2 duration-200">
            <p className="text-xs font-medium text-neutral-600 text-right mb-2">⚙️ מסננים מתקדמים</p>
            <div className="grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
          {/* Status filter - only shown if showStatusFilter is true */}
          {showStatusFilter && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-neutral-600 text-right">
                סטטוס
              </label>
              <Select value={statusFilter} onValueChange={onStatusChange}>
                <SelectTrigger className="text-right">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">פעילים בלבד</SelectItem>
                  <SelectItem value="inactive">לא פעילים בלבד</SelectItem>
                  <SelectItem value="all">הכל</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Day filter */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-neutral-600 text-right">
              יום בשבוע
            </label>
            <DayOfWeekSelect
              value={dayFilter}
              onChange={onDayChange}
              placeholder="כל הימים"
            />
          </div>

          {/* Instructor filter - only shown if showInstructorFilter is true */}
          {showInstructorFilter && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-neutral-600 text-right">
                מדריך
              </label>
              <Select value={instructorFilterId || 'all-instructors'} onValueChange={(v) => onInstructorFilterChange(v === 'all-instructors' ? '' : v)}>
                <SelectTrigger className="text-right">
                  <SelectValue placeholder="כל המדריכים" />
                </SelectTrigger>
                <SelectContent>
                  {showMyStudentsOption && currentUserId && (
                    <SelectItem value={currentUserId}>התלמידים שלי</SelectItem>
                  )}
                  <SelectItem value="all-instructors">כל המדריכים</SelectItem>
                  {instructors.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.name || inst.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Tag filter */}
          {tags.length > 0 && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-neutral-600 text-right">
                תגית
              </label>
              <Select value={tagFilter || 'all-tags'} onValueChange={(v) => onTagFilterChange(v === 'all-tags' ? '' : v)}>
                <SelectTrigger className="text-right">
                  <SelectValue placeholder="כל התגיות" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-tags">כל התגיות</SelectItem>
                  {tags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}  

          {/* Sort option */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-neutral-600 text-right">
              מיין לפי
            </label>
            <Select value={sortBy} onValueChange={onSortChange}>
              <SelectTrigger className="text-right">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STUDENT_SORT_OPTIONS.SCHEDULE}>לוח זמנים</SelectItem>
                <SelectItem value={STUDENT_SORT_OPTIONS.NAME}>שם</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Reset filters button */}
          {hasActiveFilters && (
            <div className="flex items-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onResetFilters}
                className="w-full gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                איפוס סינונים
              </Button>
            </div>
          )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
