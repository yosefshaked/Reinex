import React, { useEffect, useMemo } from 'react';
import { openTour } from '../customTour.js';
import { useUserRole } from '../hooks/useUserRole.js';
import { useOnboardingStatus } from '../hooks/useOnboardingStatus.js';
import { getTourSteps } from './TourSteps.jsx';

/**
 * WelcomeTour - Custom onboarding tour for new users (auto-run)
 * Automatically shows on first login, adapts to user role
 */
export function WelcomeTour() {
  const { isAdmin } = useUserRole();
  const { completed, loading, markCompleted } = useOnboardingStatus();

  const steps = useMemo(() => getTourSteps(isAdmin), [isAdmin]);

  useEffect(() => {
    if (loading || completed) return undefined;

    const timer = setTimeout(() => {
      openTour(steps, { onClose: () => Promise.resolve().then(() => markCompleted()) });
    }, 500);

    return () => clearTimeout(timer);
  }, [loading, completed, steps, markCompleted]);

  return null;
}
