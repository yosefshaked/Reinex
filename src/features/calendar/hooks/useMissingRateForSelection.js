import { useCallback, useState } from 'react';
import { buildRateSelectionKey, pickMissingRateForSelection } from '../utils/lessonDialogModel.js';

/**
 * Missing-rate notice state for a lesson or template form, tied to the instructor, service and date
 * it was refused for. Returns [missingRate, setMissingRate, clearMissingRate]: `missingRate` is null
 * as soon as any of the three fields differs from what they were when `setMissingRate` was called, so
 * a stale notice never offers a rate for a combination the form no longer holds. `clearMissingRate`
 * is stable, for reset effects.
 */
export function useMissingRateForSelection({ instructorId, serviceId, date }) {
  const selectionKey = buildRateSelectionKey({ instructorId, serviceId, date });
  const [stored, setStored] = useState(null);
  const setMissingRate = useCallback((missingRate) => {
    setStored(missingRate ? { missingRate, selectionKey } : null);
  }, [selectionKey]);
  const clearMissingRate = useCallback(() => setStored(null), []);
  return [pickMissingRateForSelection(stored, selectionKey), setMissingRate, clearMissingRate];
}

export default useMissingRateForSelection;
