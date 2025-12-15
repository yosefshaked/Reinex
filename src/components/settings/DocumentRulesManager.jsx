import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { FileText, Plus, Trash2, Pencil, Loader2, AlertCircle, Tag, X, Users, Briefcase } from 'lucide-react';
import { fetchSettingsValue, upsertSettings } from '@/features/settings/api/settings.js';
import { useStudentTags } from '@/features/students/hooks/useStudentTags.js';
import { useInstructorTypes } from '@/features/instructors/hooks/useInstructorTypes.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const REQUEST_STATE = {
  idle: 'idle',
  loading: 'loading',
  error: 'error',
};

function generateId() {
  return crypto.randomUUID();
}

export default function DocumentRulesManager({ session, orgId }) {
  const [loadState, setLoadState] = useState(REQUEST_STATE.idle);
  const [saveState, setSaveState] = useState(REQUEST_STATE.idle);
  const [targetType, setTargetType] = useState('students'); // 'students' or 'instructors'
  const [definitions, setDefinitions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', is_mandatory: false, target_tags: [], target_instructor_types: [], isNew: false });
  
  const { tagOptions: rawTagOptions, loadingTags, loadTags } = useStudentTags();
  const { typeOptions: rawTypeOptions, loadingTypes, loadTypes } = useInstructorTypes();
  
  // Transform tags from { id, name } to { value, label } for Select component
  const tagOptions = React.useMemo(() => {
    return rawTagOptions.map(tag => ({
      value: tag.id,
      label: tag.name
    }));
  }, [rawTagOptions]);

  // Instructor type options (already in correct format from hook)
  const typeOptions = rawTypeOptions;

  const canAct = Boolean(session && orgId);

  // Determine which settings key to use based on target type
  const settingsKey = targetType === 'students' ? 'document_definitions' : 'instructor_document_definitions';

  // Load document definitions and tags/types
  useEffect(() => {
    if (!canAct) return;

    const loadData = async () => {
      setLoadState(REQUEST_STATE.loading);
      try {
        // Load definitions and appropriate metadata (tags or types)
        const promises = [
          fetchSettingsValue({
            session,
            orgId,
            key: settingsKey,
          }),
        ];

        if (targetType === 'students') {
          promises.push(loadTags());
        } else {
          promises.push(loadTypes());
        }

        const [{ value }] = await Promise.all(promises);

        const parsed = Array.isArray(value) ? value : [];
        setDefinitions(parsed);
        setLoadState(REQUEST_STATE.idle);
      } catch (error) {
        console.error('Error loading document definitions:', error);
        setLoadState(REQUEST_STATE.error);
        toast.error('טעינת הגדרות מסמכים נכשלה');
      }
    };

    loadData();
  }, [canAct, session, orgId, settingsKey, targetType, loadTags, loadTypes]);

  const handleSave = useCallback(async () => {
    if (!canAct) return;

    setSaveState(REQUEST_STATE.loading);

    try {
      await upsertSettings({
        session,
        orgId,
        settings: {
          [settingsKey]: definitions,
        },
      });

      toast.success('הגדרות המסמכים נשמרו בהצלחה!');
      setSaveState(REQUEST_STATE.idle);
    } catch (error) {
      console.error('Save document definitions failed', error);
      toast.error(error?.message || 'שמירת הגדרות המסמכים נכשלה');
      setSaveState(REQUEST_STATE.error);
    }
  }, [canAct, session, orgId, definitions, settingsKey]);

  const handleAdd = useCallback(() => {
    const newDef = {
      id: generateId(),
      name: 'מסמך חדש',
      is_mandatory: false,
      target_tags: targetType === 'students' ? [] : undefined,
      target_instructor_types: targetType === 'instructors' ? [] : undefined,
    };
    setDefinitions((prev) => [...prev, newDef]);
    setEditingId(newDef.id);
    setEditForm({
      name: newDef.name,
      is_mandatory: newDef.is_mandatory,
      target_tags: newDef.target_tags || [],
      target_instructor_types: newDef.target_instructor_types || [],
      isNew: true, // Mark as new document
    });
  }, [targetType]);

  const handleEdit = useCallback((def) => {
    setEditingId(def.id);
    setEditForm({
      name: def.name,
      is_mandatory: def.is_mandatory,
      target_tags: def.target_tags || [],
      target_instructor_types: def.target_instructor_types || [],
      isNew: false, // Editing existing document
    });
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editForm.name.trim()) {
      toast.error('יש להזין שם למסמך');
      return;
    }

    setDefinitions((prev) =>
      prev.map((d) =>
        d.id === editingId
          ? {
              ...d,
              name: editForm.name.trim(),
              is_mandatory: editForm.is_mandatory,
              target_tags: targetType === 'students' ? editForm.target_tags : undefined,
              target_instructor_types: targetType === 'instructors' ? editForm.target_instructor_types : undefined,
            }
          : d
      )
    );
    setEditingId(null);
    setEditForm({ name: '', is_mandatory: false, target_tags: [], target_instructor_types: [], isNew: false });
  }, [editingId, editForm, targetType]);

  const handleCancelEdit = useCallback(() => {
    // If canceling a new document that hasn't been saved yet, remove it
    if (editForm.isNew && editingId) {
      setDefinitions((prev) => prev.filter((d) => d.id !== editingId));
    }
    setEditingId(null);
    setEditForm({ name: '', is_mandatory: false, target_tags: [], target_instructor_types: [] });
  }, [editingId, editForm.isNew]);

  const handleDelete = useCallback((id) => {
    if (!confirm('האם למחוק מסמך זה? פעולה זו אינה ניתנת לביטול.')) return;
    setDefinitions((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleAddTag = useCallback((tagId) => {
    if (!tagId || editForm.target_tags.includes(tagId)) return;
    setEditForm((prev) => ({ ...prev, target_tags: [...prev.target_tags, tagId] }));
  }, [editForm.target_tags]);

  const handleRemoveTag = useCallback((tagId) => {
    setEditForm((prev) => ({
      ...prev,
      target_tags: prev.target_tags.filter((id) => id !== tagId),
    }));
  }, []);

  const handleAddType = useCallback((typeId) => {
    if (!typeId || editForm.target_instructor_types.includes(typeId)) return;
    setEditForm((prev) => ({ ...prev, target_instructor_types: [...prev.target_instructor_types, typeId] }));
  }, [editForm.target_instructor_types]);

  const handleRemoveType = useCallback((typeId) => {
    setEditForm((prev) => ({
      ...prev,
      target_instructor_types: prev.target_instructor_types.filter((id) => id !== typeId),
    }));
  }, []);

  const getTagName = useCallback((tagId) => {
    const tag = tagOptions.find((t) => t.value === tagId);
    return tag?.label || tagId;
  }, [tagOptions]);

  const getTypeName = useCallback((typeId) => {
    const type = typeOptions.find((t) => t.value === typeId);
    return type?.label || typeId;
  }, [typeOptions]);

  if (loadState === REQUEST_STATE.loading) {
    return (
      <Card dir="rtl">
        <CardContent className="p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-slate-400" />
          <p className="text-sm text-slate-600">טוען הגדרות מסמכים...</p>
        </CardContent>
      </Card>
    );
  }

  if (loadState === REQUEST_STATE.error) {
    return (
      <Card dir="rtl">
        <CardContent className="p-8 text-center">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-500" />
          <p className="text-sm text-red-600">שגיאה בטעינת הגדרות המסמכים</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card dir="rtl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          הגדרות מסמכים נדרשים
        </CardTitle>
        <p className="text-sm text-slate-600 mt-2">
          הגדרת רשימת מסמכים תקניים ומחויבים עבור תלמידים או מדריכים בארגון
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Target Type Selector */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
          <Button
            variant={targetType === 'students' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => {
              setTargetType('students');
              setDefinitions([]);
              setEditingId(null);
            }}
            className="flex-1 gap-2"
          >
            <Users className="h-4 w-4" />
            תלמידים
          </Button>
          <Button
            variant={targetType === 'instructors' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => {
              setTargetType('instructors');
              setDefinitions([]);
              setEditingId(null);
            }}
            className="flex-1 gap-2"
          >
            <Briefcase className="h-4 w-4" />
            מדריכים
          </Button>
        </div>
        
        {/* Definitions List */}
        {definitions.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>לא הוגדרו מסמכים עדיין</p>
            <p className="text-sm">לחץ על "הוסף מסמך" כדי להתחיל</p>
          </div>
        ) : (
          <div className="space-y-3">
            {definitions.map((def) => (
              <div
                key={def.id}
                className={`p-4 border rounded-lg ${
                  editingId === def.id ? 'border-primary bg-primary/5' : 'border-slate-200'
                }`}
              >
                {editingId === def.id ? (
                  // Edit Mode
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor={`name-${def.id}`} className="block text-right">שם המסמך</Label>
                      <Input
                        id={`name-${def.id}`}
                        value={editForm.name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="לדוגמה: אישור רפואי"
                        className="mt-1"
                        dir="rtl"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`mandatory-${def.id}`}
                        checked={editForm.is_mandatory}
                        onCheckedChange={(checked) => setEditForm((prev) => ({ ...prev, is_mandatory: checked }))}
                      />
                      <Label htmlFor={`mandatory-${def.id}`}>מסמך חובה</Label>
                    </div>
                    
                    {/* Tag/Type Selector - Conditional based on target type */}
                    {targetType === 'students' ? (
                      <div>
                        <Label className="block text-right mb-2">תגיות יעד (אופציונלי)</Label>
                        <p className="text-xs text-slate-500 mb-2 text-right">
                          אם לא נבחרו תגיות, המסמך יחול על כל התלמידים
                        </p>
                        
                        {/* Selected Tags */}
                        {editForm.target_tags.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2" dir="rtl">
                            {editForm.target_tags.map((tagId) => (
                              <Badge key={tagId} variant="secondary" className="gap-1">
                                <Tag className="h-3 w-3" />
                                {getTagName(tagId)}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTag(tagId)}
                                  className="hover:bg-slate-300 rounded-full p-0.5"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        {/* Tag Dropdown */}
                        <Select onValueChange={handleAddTag} value="">
                          <SelectTrigger dir="rtl">
                            <SelectValue placeholder="הוסף תגית..." />
                          </SelectTrigger>
                          <SelectContent>
                            {loadingTags ? (
                              <div className="p-2 text-center text-sm text-slate-500">טוען תגיות...</div>
                            ) : tagOptions.length === 0 ? (
                              <div className="p-2 text-center text-sm text-slate-500">
                                לא נמצאו תגיות. צור תגיות דרך כרטיס "ניהול תגיות" בהגדרות.
                              </div>
                            ) : (
                              tagOptions
                                .filter((tag) => !editForm.target_tags.includes(tag.value))
                                .map((tag) => (
                                  <SelectItem key={tag.value} value={tag.value}>
                                    {tag.label}
                                  </SelectItem>
                                ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div>
                        <Label className="block text-right mb-2">סוגי מדריכים יעד (אופציונלי)</Label>
                        <p className="text-xs text-slate-500 mb-2 text-right">
                          אם לא נבחרו סוגים, המסמך יחול על כל המדריכים
                        </p>
                        
                        {/* Selected Types */}
                        {editForm.target_instructor_types.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2" dir="rtl">
                            {editForm.target_instructor_types.map((typeId) => (
                              <Badge key={typeId} variant="secondary" className="gap-1">
                                <Briefcase className="h-3 w-3" />
                                {getTypeName(typeId)}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveType(typeId)}
                                  className="hover:bg-slate-300 rounded-full p-0.5"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        {/* Type Dropdown */}
                        <Select onValueChange={handleAddType} value="">
                          <SelectTrigger dir="rtl">
                            <SelectValue placeholder="הוסף סוג מדריך..." />
                          </SelectTrigger>
                          <SelectContent>
                            {loadingTypes ? (
                              <div className="p-2 text-center text-sm text-slate-500">טוען סוגים...</div>
                            ) : typeOptions.length === 0 ? (
                              <div className="p-2 text-center text-sm text-slate-500">
                                לא נמצאו סוגי מדריכים. צור סוגים דרך כרטיס "ניהול סוגי מדריכים" בהגדרות.
                              </div>
                            ) : (
                              typeOptions
                                .filter((type) => !editForm.target_instructor_types.includes(type.value))
                                .map((type) => (
                                  <SelectItem key={type.value} value={type.value}>
                                    {type.label}
                                  </SelectItem>
                                ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveEdit}>
                        שמור
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                        ביטול
                      </Button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-semibold">{def.name}</div>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {def.is_mandatory && (
                          <Badge variant="destructive" className="text-xs">
                            חובה
                          </Badge>
                        )}
                        {!def.is_mandatory && (
                          <Badge variant="secondary" className="text-xs">
                            אופציונלי
                          </Badge>
                        )}
                        
                        {/* Show tags for students, types for instructors */}
                        {targetType === 'students' ? (
                          def.target_tags && def.target_tags.length > 0 ? (
                            def.target_tags.map((tagId) => (
                              <Badge key={tagId} variant="outline" className="text-xs gap-1">
                                <Tag className="h-3 w-3" />
                                {getTagName(tagId)}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              כל התלמידים
                            </Badge>
                          )
                        ) : (
                          def.target_instructor_types && def.target_instructor_types.length > 0 ? (
                            def.target_instructor_types.map((typeId) => (
                              <Badge key={typeId} variant="outline" className="text-xs gap-1">
                                <Briefcase className="h-3 w-3" />
                                {getTypeName(typeId)}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              כל המדריכים
                            </Badge>
                          )
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => handleEdit(def)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(def.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add Button */}
        <Button onClick={handleAdd} variant="outline" className="w-full gap-2">
          <Plus className="h-4 w-4" />
          הוסף מסמך
        </Button>

        {/* Save Button */}
        <div className="flex justify-end pt-4 border-t">
          <Button onClick={handleSave} disabled={saveState === REQUEST_STATE.loading} className="gap-2">
            {saveState === REQUEST_STATE.loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                שומר...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                שמירת הגדרות
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
