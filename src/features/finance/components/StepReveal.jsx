import React from 'react';

/**
 * A step that opens below the previous one once it may be answered: the height and opacity ease in
 * (CSS grid rows 0fr -> 1fr, no animation library). While closed it takes no space and its controls
 * cannot be reached (`inert`).
 */
export default function StepReveal({ shown, children, className = '', ...rest }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${shown ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'} ${className}`}
      inert={!shown}
      aria-hidden={!shown}
      data-shown={shown ? 'true' : 'false'}
      {...rest}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
