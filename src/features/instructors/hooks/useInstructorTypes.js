import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { fetchSettingsValue, upsertSettings } from '@/features/settings/api/settings.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

/**
 * Hook for managing instructor types catalog
 * Similar to useStudentTags but for instructor classification
 */
export function useInstructorTypes() {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  
  const [types, setTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(false);

  const loadTypes = useCallback(async () => {
    if (!session || !activeOrgId) {
      setTypes([]);
      return [];
    }

    setLoadingTypes(true);
    try {
      const { value } = await fetchSettingsValue({
        session,
        orgId: activeOrgId,
        key: 'instructor_types',
      });

      const parsed = Array.isArray(value) ? value : [];
      setTypes(parsed);
      return parsed;
    } catch (error) {
      console.error('Failed to load instructor types:', error);
      toast.error('טעינת סוגי מדריכים נכשלה');
      setTypes([]);
      return [];
    } finally {
      setLoadingTypes(false);
    }
  }, [session, activeOrgId]);

  const createType = useCallback(async (name) => {
    if (!session || !activeOrgId || !name?.trim()) {
      return null;
    }

    try {
      const currentTypes = await loadTypes();
      
      // Check for duplicates
      const duplicate = currentTypes.find(
        (t) => t.name.trim().toLowerCase() === name.trim().toLowerCase()
      );
      
      if (duplicate) {
        toast.error('סוג מדריך בשם זה כבר קיים');
        return null;
      }

      const newType = {
        id: crypto.randomUUID(),
        name: name.trim(),
      };

      const updatedTypes = [...currentTypes, newType];

      await upsertSettings({
        session,
        orgId: activeOrgId,
        settings: {
          instructor_types: updatedTypes,
        },
      });

      setTypes(updatedTypes);
      toast.success('סוג מדריך נוסף בהצלחה');
      return newType;
    } catch (error) {
      console.error('Failed to create instructor type:', error);
      toast.error('הוספת סוג מדריך נכשלה');
      return null;
    }
  }, [session, activeOrgId, loadTypes]);

  const updateType = useCallback(async (typeId, newName) => {
    if (!session || !activeOrgId || !typeId || !newName?.trim()) {
      return false;
    }

    try {
      const currentTypes = await loadTypes();
      
      // Check for duplicates (excluding the current type)
      const duplicate = currentTypes.find(
        (t) => t.id !== typeId && t.name.trim().toLowerCase() === newName.trim().toLowerCase()
      );
      
      if (duplicate) {
        toast.error('סוג מדריך בשם זה כבר קיים');
        return false;
      }

      const updatedTypes = currentTypes.map((t) =>
        t.id === typeId ? { ...t, name: newName.trim() } : t
      );

      await upsertSettings({
        session,
        orgId: activeOrgId,
        settings: {
          instructor_types: updatedTypes,
        },
      });

      setTypes(updatedTypes);
      toast.success('סוג מדריך עודכן בהצלחה');
      return true;
    } catch (error) {
      console.error('Failed to update instructor type:', error);
      toast.error('עדכון סוג מדריך נכשל');
      return false;
    }
  }, [session, activeOrgId, loadTypes]);

  const deleteType = useCallback(async (typeId) => {
    if (!session || !activeOrgId || !typeId) {
      return false;
    }

    try {
      const currentTypes = await loadTypes();
      const updatedTypes = currentTypes.filter((t) => t.id !== typeId);

      await upsertSettings({
        session,
        orgId: activeOrgId,
        settings: {
          instructor_types: updatedTypes,
        },
      });

      setTypes(updatedTypes);
      toast.success('סוג מדריך נמחק בהצלחה');
      return true;
    } catch (error) {
      console.error('Failed to delete instructor type:', error);
      toast.error('מחיקת סוג מדריך נכשלה');
      return false;
    }
  }, [session, activeOrgId, loadTypes]);

  const typeOptions = types.map((t) => ({ value: t.id, label: t.name }));

  return {
    types,
    typeOptions,
    loadingTypes,
    loadTypes,
    createType,
    updateType,
    deleteType,
  };
}
