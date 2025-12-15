import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Check, Loader2 } from 'lucide-react';
import { useOnboardingStatus } from '../hooks/useOnboardingStatus.js';
import { getTourSteps } from './TourSteps.jsx';
import { useUserRole } from '../hooks/useUserRole.js';
import { openTour } from '../customTour.js';

/**
 * OnboardingCard - Settings card to manually activate the welcome tour
 * Available to both admins and members
 */
export function OnboardingCard() {
  const { completed, reset } = useOnboardingStatus();
  const { isAdmin } = useUserRole();
  const [isStarting, setIsStarting] = useState(false);

  const handleStartTour = async () => {
    setIsStarting(true);
    await reset();

    // Small delay to ensure UI updates before measuring targets
    setTimeout(() => {
      const steps = getTourSteps(isAdmin);
      openTour(steps, {
        // Manual launch should not mark onboarding completed; just stop the spinner
        onClose: () => setIsStarting(false),
      });
    }, 300);
  };

  return (
    <Card className="group relative w-full overflow-hidden border-0 shadow-md transition-all duration-200 bg-white/80 hover:shadow-xl hover:scale-[1.02]">
      <CardHeader className="space-y-2 pb-3 flex-1">
        <div className="flex items-start gap-2">
          <div className="rounded-lg p-2 transition-colors bg-purple-100 text-purple-600 group-hover:bg-purple-600 group-hover:text-white">
            <Play className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg font-bold text-slate-900">
            סיור מודרך במערכת
          </CardTitle>
        </div>
        <p className="text-sm leading-relaxed min-h-[2.5rem] text-slate-600">
          {completed 
            ? 'השלמת את הסיור המודרך. ניתן להפעיל שוב בכל עת' 
            : 'הסיור המודרך יעזור לך להכיר את התכונות העיקריות של המערכת'
          }
        </p>
        {completed && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <Check className="h-4 w-4" />
            <span>הושלם</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0 mt-auto">
        <Button 
          size="sm" 
          className="w-full gap-2" 
          onClick={handleStartTour}
          disabled={isStarting}
          variant="default"
        >
          {isStarting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> מפעיל...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> 
              {completed ? 'הפעל שוב' : 'התחל סיור'}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
