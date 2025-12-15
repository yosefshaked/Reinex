import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Enhanced DialogHeader with clean design and custom close button
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.icon - Icon component to display in the header
 * @param {string} props.title - Title text to display
 * @param {Function} props.onClose - Callback when close button is clicked
 * @param {string} props.className - Additional classes for the header container
 */
export function EnhancedDialogHeader({ 
  icon, 
  title, 
  onClose,
  className
}) {
  return (
    <div className={cn(
      "relative flex items-center border-b bg-white px-6 py-4",
      className
    )} dir="rtl">
      {/* Title and icon on the right for RTL - comes first in markup */}
      <div className="flex items-center gap-3 flex-1">
        {icon && (
          <div className="rounded-lg bg-blue-50 p-2.5 text-blue-600">
            {React.cloneElement(icon, { className: 'h-5 w-5' })}
          </div>
        )}
        <h2 className="text-xl font-bold text-slate-900">
          {title}
        </h2>
      </div>
      
      {/* Close button on the left for RTL - comes last in markup */}
      {onClose && (
        <button
          onClick={onClose}
          className="group rounded-lg p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex-shrink-0"
          aria-label="סגור"
        >
          <X className="h-5 w-5 transition-transform group-hover:rotate-90" />
        </button>
      )}
    </div>
  );
}
