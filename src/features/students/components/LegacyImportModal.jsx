import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  FileSpreadsheet,
  ShieldAlert,
  Upload,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ListChecks,
  FilePenLine,
  Table,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import './LegacyImportModal.css';

const STEPS = Object.freeze({
  welcome: 'welcome',
  upload: 'upload',
  mapping: 'mapping',
  preview: 'preview',
  confirm: 'confirm',
});

const STEP_SEQUENCE = [STEPS.welcome, STEPS.upload, STEPS.mapping, STEPS.preview, STEPS.confirm];

// Sentinel for "skip this column" in the match-mapping flow. We can't use an empty string
// as a Select item value because Radix Select reserves empty string for clearing selection.
const SKIP_VALUE = '__skip__';

function parseCsvColumns(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) {
    return [];
  }
  const headerLine = lines[0];
  const parts = headerLine.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  return parts
    .map((part) => part.trim().replace(/^"|"$/g, ''))
    .filter((part) => part);
}

function parseCsvRows(text, columns, limit = 3) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 1 || !columns.length) {
    return [];
  }
  const rows = [];
  for (let i = 1; i < lines.length && rows.length < limit; i += 1) {
    const raw = lines[i].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((part) => part.trim().replace(/^"|"$/g, ''));
    const row = {};
    columns.forEach((column, index) => {
      row[column] = raw[index] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function normalize(str) {
  return (str || '').toString().trim().toLowerCase();
}

function buildQuestionOptions(questions) {
  if (!Array.isArray(questions)) {
    return [];
  }
  return questions.map((question) => ({
    key: question.key || question.id || question.label,
    label: question.label || question.key || 'שאלה',
  }));
}

export default function LegacyImportModal({
  open,
  onClose,
  studentName,
  questions,
  hasLegacyImport,
  services = [],
  servicesLoading = false,
  servicesError = '',
  onReloadServices,
  onSubmit,
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState(STEPS.welcome);
  const [structureChoice, setStructureChoice] = useState(null); // 'match' | 'custom'
  const [fileName, setFileName] = useState('');
  const [csvColumns, setCsvColumns] = useState([]);
  const [csvText, setCsvText] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [sessionDateColumn, setSessionDateColumn] = useState('');
  const [columnMappings, setColumnMappings] = useState({});
  const [customLabels, setCustomLabels] = useState({});
  const [excludedColumns, setExcludedColumns] = useState({});
  const [serviceMode, setServiceMode] = useState('fixed');
  const [selectedService, setSelectedService] = useState('');
  const [customService, setCustomService] = useState('');
  const [serviceColumn, setServiceColumn] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  // Track if ANY Select is currently open to prevent Dialog from closing prematurely on mobile.
  // Use a ref to avoid stale closures + a counter to handle multiple Selects open simultaneously.
  const openSelectCountRef = useRef(0);
  const closeTimeoutRef = useRef(null);
  const isClosingSelectRef = useRef(false); // Flag to track if we're closing a Select

  const questionOptions = useMemo(() => buildQuestionOptions(questions), [questions]);
  const serviceOptions = useMemo(() => {
    if (!Array.isArray(services)) {
      return [];
    }
    const unique = new Set();
    const options = [];
    services.forEach((service) => {
      if (typeof service !== 'string') {
        return;
      }
      const trimmed = service.trim();
      if (!trimmed || unique.has(trimmed)) {
        return;
      }
      unique.add(trimmed);
      options.push(trimmed);
    });
    return options;
  }, [services]);
  const isMatchFlow = structureChoice === 'match';
  const hasColumns = csvColumns.length > 0;
  const hasDateSelection = Boolean(sessionDateColumn);

  const effectiveCustomLabels = useMemo(() => {
    const entries = {};
    csvColumns.forEach((column) => {
      if (excludedColumns[column]) {
        return;
      }
      const rawValue = customLabels[column];
      const label = typeof rawValue === 'string' && rawValue.trim() ? rawValue.trim() : column;
      entries[column] = label;
    });
    return entries;
  }, [csvColumns, customLabels, excludedColumns]);

  const effectiveColumnMappings = useMemo(() => {
    const out = {};
    for (const [col, val] of Object.entries(columnMappings)) {
      if (val && val !== SKIP_VALUE && !excludedColumns[col]) {
        out[col] = val;
      }
    }
    return out;
  }, [columnMappings, excludedColumns]);

  const hasMappings = useMemo(() => {
    if (isMatchFlow) {
      return Object.keys(effectiveColumnMappings).length > 0;
    }
    return Object.keys(effectiveCustomLabels).length > 0;
  }, [isMatchFlow, effectiveColumnMappings, effectiveCustomLabels]);

  const serviceSelectionValid = useMemo(() => {
    if (!hasColumns) {
      return false;
    }

    if (serviceMode === 'column') {
      return Boolean(serviceColumn) && csvColumns.includes(serviceColumn);
    }

    const typed = customService.trim();
    if (typed) {
      return true;
    }

    return Boolean(selectedService);
  }, [hasColumns, serviceMode, serviceColumn, csvColumns, selectedService, customService]);

  const effectiveServiceValue = useMemo(() => {
    if (customService.trim()) {
      return customService.trim();
    }
    if (selectedService === '__none__') {
      return '';
    }
    return selectedService;
  }, [customService, selectedService]);

  const canAdvanceFromMapping = hasColumns && hasDateSelection && hasMappings && serviceSelectionValid;

  const previewRows = useMemo(() => parseCsvRows(csvText, csvColumns, 3), [csvText, csvColumns]);

  const parseSessionDateValue = (value) => {
    const raw = (value ?? '').toString().trim();
    if (!raw) {
      return { original: raw, parsed: '—' };
    }

    const attemptDate = (date) => {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
      }
      return date.toLocaleDateString('he-IL');
    };

    const excelSerial = Number(raw);
    if (!Number.isNaN(excelSerial) && raw !== '') {
      const base = new Date(Date.UTC(1899, 11, 30));
      const parsed = attemptDate(new Date(base.getTime() + excelSerial * 24 * 60 * 60 * 1000));
      if (parsed) {
        return { original: raw, parsed };
      }
    }

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [year, month, day] = isoMatch.slice(1).map(Number);
      const parsed = attemptDate(new Date(Date.UTC(year, month - 1, day)));
      if (parsed) {
        return { original: raw, parsed };
      }
    }

    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [day, month, year] = slashMatch.slice(1).map(Number);
      const parsed = attemptDate(new Date(Date.UTC(year, month - 1, day)));
      if (parsed) {
        return { original: raw, parsed };
      }
    }

    const dotMatch = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dotMatch) {
      const [day, month, year] = dotMatch.slice(1).map(Number);
      const parsed = attemptDate(new Date(Date.UTC(year, month - 1, day)));
      if (parsed) {
        return { original: raw, parsed };
      }
    }

    const nativeParsed = attemptDate(new Date(raw));
    if (nativeParsed) {
      return { original: raw, parsed: nativeParsed };
    }

    return { original: raw, parsed: 'תאריך לא זוהה' };
  };

  const mappedPreviewRows = useMemo(() => {
    if (!previewRows.length) {
      return [];
    }

    const buildDateColumns = (row) => {
      if (!sessionDateColumn) {
        return {};
      }
      const parsed = parseSessionDateValue(row[sessionDateColumn]);
      return {
        'תאריך מפגש (מקורי)': parsed.original || '—',
        'תאריך מפגש (מפוענח)': parsed.parsed,
      };
    };

    if (isMatchFlow) {
      return previewRows.map((row) => {
        const mapped = { ...buildDateColumns(row) };
        Object.entries(effectiveColumnMappings).forEach(([column, value]) => {
          const match = questionOptions.find((option) => option.key === value);
          mapped[match?.label || value] = row[column];
        });
        return mapped;
      });
    }

    return previewRows.map((row) => {
      const mapped = { ...buildDateColumns(row) };
      Object.entries(effectiveCustomLabels).forEach(([column, value]) => {
        mapped[value] = row[column];
      });
      return mapped;
    });
  }, [previewRows, isMatchFlow, effectiveColumnMappings, effectiveCustomLabels, questionOptions, sessionDateColumn]);

  useEffect(() => {
    if (!open) {
      setStep(STEPS.welcome);
      setStructureChoice(null);
      setFileName('');
      setCsvColumns([]);
      setCsvText('');
      setUploadError('');
      setSessionDateColumn('');
      setColumnMappings({});
      setCustomLabels({});
      setExcludedColumns({});
      setServiceMode('fixed');
      setSelectedService('');
      setCustomService('');
      setServiceColumn('');
      setIsSubmitting(false);
      setSubmitError('');
      setSelectedFile(null);
      openSelectCountRef.current = 0;
      isClosingSelectRef.current = false;
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    if (!hasColumns) {
      setSessionDateColumn('');
      setColumnMappings({});
      setCustomLabels({});
      setExcludedColumns({});
      setServiceColumn('');
    }
  }, [hasColumns]);

  useEffect(() => {
    setCustomLabels((prev) => {
      const next = {};
      csvColumns.forEach((column) => {
        if (Object.prototype.hasOwnProperty.call(prev, column)) {
          next[column] = prev[column];
        } else {
          next[column] = column;
        }
      });
      return next;
    });

    setExcludedColumns((prev) => {
      const next = {};
      csvColumns.forEach((column) => {
        if (prev[column]) {
          next[column] = true;
        }
      });
      return next;
    });
  }, [csvColumns]);

  useEffect(() => {
    if (serviceMode === 'column') {
      setSelectedService('');
      setCustomService('');
    } else {
      setServiceColumn('');
    }
  }, [serviceMode]);

  useEffect(() => {
    if (serviceMode === 'fixed' && !selectedService && !customService && serviceOptions.length === 0) {
      setSelectedService('__none__');
    }
  }, [serviceMode, selectedService, customService, serviceOptions.length]);

  useEffect(() => {
    if (sessionDateColumn) {
      setExcludedColumns((prev) => {
        if (Object.prototype.hasOwnProperty.call(prev, sessionDateColumn)) {
          return prev;
        }
        return {
          ...prev,
          [sessionDateColumn]: true,
        };
      });
    }
  }, [sessionDateColumn]);

  useEffect(() => {
    if (!isMatchFlow || !hasColumns || !questionOptions.length) {
      return;
    }

    setColumnMappings((prev) => {
      const next = { ...prev };
      csvColumns.forEach((column) => {
        if (excludedColumns[column] || next[column]) {
          return;
        }
        const found = questionOptions.find(
          (option) => normalize(option.label) === normalize(column) || normalize(option.key) === normalize(column),
        );
        if (found) {
          next[column] = found.key;
        }
      });
      return next;
    });
  }, [isMatchFlow, hasColumns, questionOptions, csvColumns, excludedColumns]);

  const handleNavigateToBackup = () => {
    navigate('/settings#backup');
    if (onClose) {
      onClose();
    }
  };

  const handleFileChange = (event) => {
    const file = event?.target?.files?.[0];
    setUploadError('');
    setCsvColumns([]);
    setCsvText('');
    setStructureChoice(null);
    setSelectedFile(null);
    setFileName('');
    setSessionDateColumn('');
    setColumnMappings({});
    setCustomLabels({});
    setExcludedColumns({});
    setServiceMode('fixed');
    setSelectedService('');
    setCustomService('');
    setServiceColumn('');

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('ניתן לייבא רק קבצי CSV.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result || '';
      const columns = parseCsvColumns(String(text));
      if (!columns.length) {
        setUploadError('לא נמצאו כותרות בקובץ. ודאו שקובץ ה-CSV כולל שורת כותרות.');
        return;
      }
      setCsvColumns(columns);
      setCsvText(String(text));
      setSelectedFile(file);
      setFileName(file.name);
    };
    reader.onerror = () => {
      setUploadError('טעינת הקובץ נכשלה. נסו שנית.');
    };
    reader.readAsText(file);
  };

  const handleClearFile = () => {
    setUploadError('');
    setCsvColumns([]);
    setCsvText('');
    setSelectedFile(null);
    setFileName('');
    setSessionDateColumn('');
    setColumnMappings({});
    setCustomLabels({});
    setExcludedColumns({});
    setStructureChoice(null);
    setServiceMode('fixed');
    setSelectedService('');
    setCustomService('');
    setServiceColumn('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleMappingChange = (column, value) => {
    setColumnMappings((prev) => ({
      ...prev,
      [column]: value,
    }));
  };

  const handleCustomLabelChange = (column, value) => {
    setCustomLabels((prev) => ({
      ...prev,
      [column]: value,
    }));
  };

  const toggleColumnInclusion = (column) => {
    setExcludedColumns((prev) => ({
      ...prev,
      [column]: !prev[column],
    }));
  };

  const handleSelectStructure = (choice) => {
    setStructureChoice(choice);
  };

  // Handler to track Select open/close state using a counter (supports multiple Selects)
  const handleSelectOpenChange = (isOpen) => {
    if (!isOpen && openSelectCountRef.current > 0) {
      isClosingSelectRef.current = true;
      setTimeout(() => {
        openSelectCountRef.current -= 1;
        if (openSelectCountRef.current < 0) {
          openSelectCountRef.current = 0;
        }
        isClosingSelectRef.current = false;
      }, 100);
    } else if (isOpen) {
      openSelectCountRef.current += 1;
    }
  };

  const handleProceedToConfirm = () => {
    if (!canAdvanceFromMapping) {
      return;
    }
    setStep(STEPS.preview);
  };

  const handleSubmit = async () => {
    if (!onSubmit || !selectedFile) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({
        file: selectedFile,
        structureChoice,
        sessionDateColumn,
        columnMappings: isMatchFlow ? effectiveColumnMappings : {},
        customLabels: isMatchFlow ? {} : effectiveCustomLabels,
        serviceMode,
        serviceValue: effectiveServiceValue,
        serviceColumn,
      });
    } catch (error) {
      const message = error?.message || 'ייבוא הדוח נכשל. נסו שוב.';
      setSubmitError(message);
      return;
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderWarningStep = () => (
    <div className="legacy-import-step space-y-4">
      <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-800">
        <div className="legacy-import-warning-row">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          <div className="legacy-import-warning-text">
            <AlertTitle className="rtl-embed-text text-right">ייבוא דוחות היסטוריים</AlertTitle>
            <AlertDescription className="space-y-2 text-sm rtl-embed-text text-right">
              <p>
                <strong>חשוב:</strong> לפני ייבוא נתונים, מומלץ לבצע <strong>גיבוי</strong> מלא של נתוני הארגון כדי שתוכלו לשחזר במידת הצורך.
              </p>
            </AlertDescription>
          </div>
        </div>
      </Alert>
      {hasLegacyImport ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-800 rtl-embed-text">
          <div className="legacy-import-warning-row">
            <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            <div className="legacy-import-warning-text">
              <AlertTitle className="rtl-embed-text text-right">נמצאו דוחות Legacy קיימים לתלמיד זה</AlertTitle>
              <AlertDescription className="text-sm rtl-embed-text text-right">
                ייבוא חדש ימחק את הדוחות ההיסטוריים הקיימים ויחליף אותם בנתונים החדשים.
              </AlertDescription>
            </div>
          </div>
        </Alert>
      ) : null}
      <p className="text-xs text-neutral-700 rtl-embed-text text-right">
        צריכים לבצע גיבוי? <button type="button" className="legacy-import-warning-link" onClick={handleNavigateToBackup}>עברו להגדרות</button> לפני שממשיכים.
      </p>
    </div>
  );

  const renderCsvUpload = () => (
    <div className="space-y-3">
      <div className="space-y-1 rtl-embed-text text-right">
        <Label htmlFor="legacy-csv-upload" className="block text-right text-sm font-semibold text-foreground rtl-embed-text">
          העלאת קובץ CSV
        </Label>
        <p className="text-xs text-neutral-600 text-right">בחרו את קובץ ה-CSV עם כותרות העמודות שברצונכם לייבא.</p>
      </div>
      {selectedFile ? (
        <div className="legacy-import-file-row">
          <div className="space-y-1 rtl-embed-text text-right">
            <p className="text-xs font-semibold text-neutral-800">קובץ שנבחר: {fileName}</p>
            <p className="text-xs text-neutral-600">החליפו את הקובץ אם ברצונכם להעלות גרסה אחרת.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="legacy-import-row-reverse legacy-import-utility-button"
            onClick={handleClearFile}
          >
            <XCircle className="h-4 w-4" aria-hidden="true" /> הסרת קובץ
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-between">
            <Input
              id="legacy-csv-upload"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              aria-describedby="legacy-csv-helper"
              className="rtl-embed-text text-right"
              ref={fileInputRef}
            />
          </div>
          <p id="legacy-csv-helper" className="text-xs text-neutral-600 rtl-embed-text text-right">
            ודאו שהשורה הראשונה מכילה כותרות. המערכת תציג אותן למיפוי שאלות.
          </p>
        </>
      )}
      {uploadError ? (
        <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-800">
          <AlertTitle className="text-sm font-semibold rtl-embed-text text-right">שגיאת העלאה</AlertTitle>
          <AlertDescription className="text-sm rtl-embed-text text-right">{uploadError}</AlertDescription>
        </Alert>
      ) : null}
      {hasColumns ? (
        <div className="space-y-2 rounded-md bg-neutral-50 p-3">
          <p className="text-xs font-semibold text-neutral-700 rtl-embed-text text-right">כותרות שאותרו:</p>
          <div className="legacy-import-tags">
            {csvColumns.map((column) => (
              <span key={column} className="legacy-import-tag">
                {column}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  const renderStructureChoice = () => (
    <div className="space-y-4">
      <div className="space-y-2 rtl-embed-text text-right">
        <h3 className="text-base font-semibold text-foreground">האם מבנה ה-CSV תואם את טופס המפגש הנוכחי?</h3>
        <p className="text-sm text-neutral-600">
          בחרו האם לעדכן לפי שאלות הטופס הקיים או להזין שמות מותאמים לשדות מהעבר.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          type="button"
          variant={structureChoice === 'match' ? 'secondary' : 'outline'}
          data-selected={structureChoice === 'match'}
          className="legacy-import-row-reverse legacy-import-cta-button text-right"
          onClick={() => handleSelectStructure('match')}
        >
          <div className="flex flex-col items-start rtl-embed-text text-right">
            <span className="font-semibold">כן, המבנה תואם</span>
            <span className="text-xs text-neutral-600">בחרו באפשרות זו אם לקובץ ה-CSV יש את אותן עמודות כמו בטופס התיעוד הנוכחי. המערכת תנסה למפות אותן אוטומטית.</span>
          </div>
          <ListChecks className="h-4 w-4 legacy-import-cta-icon" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant={structureChoice === 'custom' ? 'secondary' : 'outline'}
          data-selected={structureChoice === 'custom'}
          className="legacy-import-row-reverse legacy-import-cta-button text-right"
          onClick={() => handleSelectStructure('custom')}
        >
          <div className="flex flex-col items-start rtl-embed-text text-right">
            <span className="font-semibold">לא, מבנה שונה</span>
            <span className="text-xs text-neutral-600">בחרו באפשרות זו כדי למפות באופן ידני את עמודות הקובץ לשדות המערכת.</span>
          </div>
          <FilePenLine className="h-4 w-4 legacy-import-cta-icon" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );

  const renderUploadStep = () => (
    <div className="legacy-import-step space-y-4">
      <div className="legacy-import-card space-y-6">{renderCsvUpload()}</div>
      <div className="legacy-import-card space-y-6">{renderStructureChoice()}</div>
    </div>
  );

  const renderSessionDatePicker = () => (
    <div className="legacy-import-card space-y-2">
      <div className="space-y-1 rtl-embed-text text-right">
        <Label
          className="block text-right text-sm font-semibold text-foreground rtl-embed-text"
          htmlFor="session-date-column"
        >
          עמודת תאריך המפגש
        </Label>
        <p className="text-xs text-neutral-600">בחרו את העמודה שמייצגת את התאריך כדי לראות אותה בתצוגה המקדימה.</p>
      </div>
      <Select
        modal={true}
        value={sessionDateColumn}
        onValueChange={setSessionDateColumn}
        onOpenChange={handleSelectOpenChange}
      >
        <SelectTrigger id="session-date-column" className="rtl-embed-text text-right">
          <SelectValue placeholder="בחרו את העמודה שמייצגת את תאריך המפגש" />
        </SelectTrigger>
        <SelectContent>
          {csvColumns.map((column) => (
            <SelectItem key={column} value={column}>
              {column}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-neutral-600 rtl-embed-text text-right">
        עמודת התאריך תוצג בתצוגה המקדימה לצד שאר העמודות ותוסתר מהמיפוי הדו-כיווני כברירת מחדל.
      </p>
    </div>
  );

  const renderServiceSelection = () => (
    <div className="legacy-import-card space-y-3">
      <div className="legacy-import-row-reverse flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 rtl-embed-text text-right">
          <h4 className="text-sm font-semibold text-foreground">שיוך שירות למפגשים</h4>
          <p className="text-xs text-neutral-600">
            בחרו אם כל השורות יקבלו אותו שירות או אם יש עמודה בקובץ שמגדירה שירות לכל מפגש.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {servicesLoading ? <Loader2 className="h-4 w-4 animate-spin text-neutral-500" aria-hidden="true" /> : null}
          {onReloadServices ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="legacy-import-row-reverse legacy-import-utility-button"
              onClick={onReloadServices}
              disabled={servicesLoading}
              title="רענון רשימת השירותים מההגדרות"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> רענון
            </Button>
          ) : null}
        </div>
      </div>
      {servicesError ? (
        <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-800">
          <AlertTitle className="text-sm font-semibold rtl-embed-text text-right">שגיאת טעינת שירותים</AlertTitle>
          <AlertDescription className="text-sm rtl-embed-text text-right">{servicesError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant={serviceMode === 'fixed' ? 'secondary' : 'outline'}
          data-selected={serviceMode === 'fixed'}
          className="legacy-import-row-reverse legacy-import-cta-button"
          onClick={() => setServiceMode('fixed')}
        >
          <div className="flex flex-col items-start text-right rtl-embed-text">
            <span className="font-semibold">שירות אחיד לכל השורות</span>
            <span className="text-xs text-neutral-600">בחרו שירות אחד או הקלידו שם שירות מותאם</span>
          </div>
          <CheckCircle2 className="h-4 w-4 legacy-import-cta-icon" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant={serviceMode === 'column' ? 'secondary' : 'outline'}
          data-selected={serviceMode === 'column'}
          className="legacy-import-row-reverse legacy-import-cta-button"
          disabled={!hasColumns}
          onClick={() => setServiceMode('column')}
        >
          <div className="flex flex-col items-start text-right rtl-embed-text">
            <span className="font-semibold">שירות לפי עמודה בקובץ</span>
            <span className="text-xs text-neutral-600">בחרו עמודת שירות מתוך הכותרות שהועלו</span>
          </div>
          <Table className="h-4 w-4 legacy-import-cta-icon" aria-hidden="true" />
        </Button>
      </div>

      {serviceMode === 'fixed' ? (
        <div className="space-y-3 rounded-md border border-neutral-200 bg-white p-3">
          {serviceOptions.length ? (
            <div className="space-y-2">
              <Label className="block text-right text-sm font-semibold text-foreground rtl-embed-text" htmlFor="fixed-service-select">
                בחירת שירות מהרשימה
              </Label>
              <Select
                modal={true}
                value={selectedService}
                onValueChange={setSelectedService}
                onOpenChange={handleSelectOpenChange}
              >
                <SelectTrigger id="fixed-service-select" className="rtl-embed-text text-right">
                  <SelectValue placeholder="בחרו שירות שיוחל על כל השורות" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">ללא שירות</SelectItem>
                  {serviceOptions.map((service) => (
                    <SelectItem key={service} value={service}>
                      {service}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-neutral-600 rtl-embed-text">השארת שדה ריק תשמור את המפגשים ללא שירות מוגדר.</p>
            </div>
          ) : (
            <p className="text-xs text-neutral-700 rtl-embed-text">לא נמצאו שירותים שמורים בארגון. ניתן להקליד שירות מותאם ידנית.</p>
          )}
          <div className="space-y-1">
            <Label className="block text-right text-sm font-semibold text-foreground rtl-embed-text" htmlFor="custom-service-input">
              או הקלידו שם שירות מותאם
            </Label>
            <Input
              id="custom-service-input"
              value={customService}
              onChange={(event) => setCustomService(event.target.value)}
              placeholder="לדוגמה: שירות ייעוצי / סדנה / פעילות"
              className="rtl-embed-text"
            />
            <p className="text-[11px] text-neutral-600 rtl-embed-text">ערך זה יגבר על הבחירה מהרשימה אם מולא.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-neutral-200 bg-white p-3">
          <Label className="block text-right text-sm font-semibold text-foreground rtl-embed-text" htmlFor="service-column-select">
            עמודת שירות מתוך הקובץ
          </Label>
          <Select
            modal={true}
            value={serviceColumn}
            onValueChange={setServiceColumn}
            onOpenChange={handleSelectOpenChange}
            disabled={!hasColumns}
          >
            <SelectTrigger id="service-column-select" className="rtl-embed-text text-right">
              <SelectValue placeholder="בחרו את העמודה שמייצגת את השירות" />
            </SelectTrigger>
            <SelectContent>
              {csvColumns.map((column) => (
                <SelectItem key={column} value={column}>
                  {column}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-neutral-600 rtl-embed-text">ערכים ריקים בעמודה יישמרו ללא שיוך שירות.</p>
        </div>
      )}
    </div>
  );

  const renderMatchMapping = () => (
    <div className="space-y-3">
      <div className="space-y-1 rtl-embed-text text-right">
        <h4 className="text-sm font-semibold text-foreground">מיפוי שדות חובה</h4>
        <p className="text-xs text-neutral-600">
          התאימו כל עמודה לשאלה בטופס המפגש. ניתן להשאיר עמודה ללא מיפוי כדי לדלג עליה.
        </p>
      </div>
      <div className="space-y-3">
        {csvColumns.map((column) => {
          const isDateColumn = sessionDateColumn === column;
          const isExcluded = Boolean(excludedColumns[column]);

          return (
            <div key={column} className="space-y-2 rounded-md border border-neutral-200 p-3">
              <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-between">
                <div className="flex-1 space-y-1">
                  <Label className="block text-right text-sm font-semibold text-foreground rtl-embed-text" htmlFor={`map-${column}`}>
                    {column}
                  </Label>
                  <Select
                    modal={true}
                    value={columnMappings[column] || ''}
                    onValueChange={(value) => handleMappingChange(column, value)}
                    onOpenChange={handleSelectOpenChange}
                    disabled={isExcluded}
                  >
                    <SelectTrigger id={`map-${column}`} className="rtl-embed-text text-right">
                      <SelectValue placeholder="בחרו שאלה או דלגו" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP_VALUE}>דלגו על עמודה זו</SelectItem>
                      {questionOptions.map((option) => (
                        <SelectItem key={option.key} value={option.key}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-neutral-600 rtl-embed-text text-right">
                    {!isExcluded ? 'בחרו "דלגו" כדי להחריג עמודה זו.' : 'עמודה זו מוחרגת ולא תיכלל בייבוא.'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 sm:items-center sm:gap-3">
                  <Button
                    type="button"
                    variant={isExcluded ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => toggleColumnInclusion(column)}
                  >
                    {isExcluded ? 'הכלל' : 'החרג'}
                  </Button>
                  {isDateColumn ? (
                    <span className="text-[11px] text-neutral-700 rtl-embed-text text-right">עמודת תאריך</span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderCustomMapping = () => (
    <div className="space-y-3">
      <div className="space-y-1 rtl-embed-text text-right">
        <h4 className="text-sm font-semibold text-foreground">מיפוי שדות חובה</h4>
        <p className="text-xs text-neutral-600">תנו שם לכל עמודה כפי שהיא צריכה להופיע במערכת.</p>
      </div>
      <div className="space-y-3">
        {csvColumns.map((column) => {
          const isExcluded = Boolean(excludedColumns[column]);
          const isDateColumn = sessionDateColumn === column;
          return (
            <div key={column} className="space-y-2 rounded-md border border-neutral-200 p-3">
              <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-between">
                <div className="flex-1 space-y-1">
                  <Label className="block text-right text-sm font-semibold text-foreground rtl-embed-text" htmlFor={`label-${column}`}>
                    {column}
                  </Label>
                  <Input
                    id={`label-${column}`}
                    value={customLabels[column] || ''}
                    onChange={(event) => handleCustomLabelChange(column, event.target.value)}
                    disabled={isExcluded}
                    className="rtl-embed-text"
                  />
                  <p className="text-[11px] text-neutral-600 rtl-embed-text text-right">
                    {!isExcluded ? 'ניתן להשאיר את השם המקורי או להקליד שם מותאם.' : 'עמודה זו מוחרגת ולא תיכלל בייבוא.'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 sm:items-center sm:gap-3">
                  <Button
                    type="button"
                    variant={isExcluded ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => toggleColumnInclusion(column)}
                  >
                    {isExcluded ? 'הכלל' : 'החרג'}
                  </Button>
                  {isDateColumn ? (
                    <span className="text-[11px] text-neutral-700 rtl-embed-text text-right">עמודת תאריך</span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderMappingStep = () => (
    <div className="legacy-import-step space-y-4">
      <div className="legacy-import-card space-y-4">
        <div className="space-y-1 rtl-embed-text text-right">
          <h4 className="text-sm font-semibold text-foreground">עמודת תאריך ושיוך שירות</h4>
          <p className="text-xs text-neutral-600">בחרו את עמודת התאריך ולאחר מכן הגדירו את שיוך השירותים.</p>
        </div>
        <div className="space-y-3">
          {renderSessionDatePicker()}
          {renderServiceSelection()}
        </div>
      </div>
      <div className="legacy-import-card space-y-4">
        <div className="space-y-1 rtl-embed-text text-right">
          <h4 className="text-sm font-semibold text-foreground">מיפוי שאלות המפגש</h4>
          <p className="text-xs text-neutral-600">התאימו כל עמודה לשדה נכון בטופס או הגדירו שם מותאם.</p>
        </div>
        {isMatchFlow ? renderMatchMapping() : renderCustomMapping()}
      </div>
    </div>
  );

  const renderPreviewStep = () => (
    <div className="legacy-import-step space-y-4">
      <div className="legacy-import-card space-y-3">
        <div className="space-y-1 rtl-embed-text text-right">
          <p className="text-sm font-semibold text-foreground">כך המערכת מפרשת את הנתונים שלך.</p>
          <p className="text-xs text-neutral-600">ודאו שהשורות הראשונות מעובדות כהלכה לפני שתמשיכו.</p>
        </div>
        {!mappedPreviewRows.length ? (
          <p className="text-sm text-neutral-700 rtl-embed-text text-right">לא נמצאו שורות תצוגה מקדימה. ודאו שקובץ ה-CSV כולל נתונים מעבר לשורת הכותרות.</p>
        ) : (
          <>
            <div className="legacy-import-preview-mobile">
              {mappedPreviewRows.slice(0, 2).map((row, index) => (
                <div className="legacy-import-preview-card space-y-2" key={`preview-mobile-${index}`}>
                  <div className="flex items-center justify-between rtl-embed-text text-right">
                    <p className="text-sm font-semibold text-foreground">דוגמה {index + 1}</p>
                    <span className="text-[11px] text-neutral-600">תצוגה ניידת</span>
                  </div>
                  <dl className="legacy-import-preview-list rtl-embed-text text-right">
                    {Object.entries(row).map(([header, value]) => {
                      const isDateHeader = header.includes('תאריך מפגש');
                      return (
                        <div className="legacy-import-preview-list-row" key={`${header}-${index}`}>
                          <dt className="legacy-import-preview-term" aria-label={`${header} label`}>
                            {header}
                          </dt>
                          <dd className={`legacy-import-preview-value${isDateHeader ? ' legacy-import-preview-date' : ''}`}>
                            {value || '—'}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ))}
            </div>
            <div className="legacy-import-table-wrapper legacy-import-preview-desktop">
              <table className="legacy-import-table">
                <thead>
                  <tr>
                    {Object.keys(mappedPreviewRows[0]).map((header) => {
                      const isDateHeader = header.includes('תאריך מפגש');
                      return (
                        <th key={header} scope="col" className={isDateHeader ? 'legacy-import-date-col' : undefined}>
                          {header}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {mappedPreviewRows.map((row, index) => (
                    <tr key={`preview-${index}`}>
                      {Object.keys(row).map((header) => {
                        const isDateHeader = header.includes('תאריך מפגש');
                        return (
                          <td key={`${header}-${index}`} className={isDateHeader ? 'legacy-import-date-col' : undefined}>
                            {row[header] || '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderConfirmStep = () => (
    <div className="legacy-import-step space-y-4">
      <div className="legacy-import-card space-y-3">
        <div className="space-y-1 rtl-embed-text text-right">
          <h4 className="text-sm font-semibold text-foreground">פרטי קובץ</h4>
          <p className="text-sm text-neutral-700">שם הקובץ: {fileName || 'לא נבחר קובץ'}</p>
        </div>
        <Separator />
        <div className="space-y-1 rtl-embed-text text-right">
          <h4 className="text-sm font-semibold text-foreground">תצורת מיפוי</h4>
          <p className="text-sm text-neutral-700">בחירת מבנה: {structureChoice === 'match' ? 'התאמת שדות קיימים' : 'שמות מותאמים אישית'}</p>
        </div>
        <Separator />
        <div className="space-y-2 rtl-embed-text text-right">
          <h4 className="text-sm font-semibold text-foreground">מיפויים שנקבעו</h4>
          {isMatchFlow ? (
            <ul className="list-disc space-y-1 pr-5 text-neutral-700 rtl-embed-text text-right">
              {Object.entries(effectiveColumnMappings)
                .filter(([, value]) => value && value !== SKIP_VALUE)
                .map(([column, value]) => {
                  const match = questionOptions.find((option) => option.key === value);
                  return (
                    <li key={column}>{column} ← {match?.label || value}</li>
                  );
                })}
            </ul>
          ) : (
            <ul className="list-disc space-y-1 pr-5 text-neutral-700 rtl-embed-text text-right">
              {Object.entries(effectiveCustomLabels).map(([column, value]) => (
                <li key={column}>{column} ← {value}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {hasLegacyImport ? (
        <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-800">
          <div className="legacy-import-warning-row">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            <div className="legacy-import-warning-text">
              <AlertTitle className="text-sm font-semibold rtl-embed-text text-right">אזהרת העלאה חוזרת</AlertTitle>
              <AlertDescription className="text-sm space-y-1 rtl-embed-text text-right">
                <p>פעולה זו תמחק את כל הדוחות ההיסטוריים שנאספו בעבר לתלמיד זה ותשמור רק את הייבוא החדש.</p>
                <p>הפעולה בלתי הפיכה. האם להמשיך?</p>
              </AlertDescription>
            </div>
          </div>
        </Alert>
      ) : null}
      {submitError ? (
        <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-800">
          <AlertTitle className="text-sm font-semibold rtl-embed-text text-right">הייבוא נכשל</AlertTitle>
          <AlertDescription className="text-sm rtl-embed-text text-right">{submitError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );

  const title = (() => {
    if (step === STEPS.welcome) {
      return 'ייבוא דוחות היסטוריים';
    }
    if (step === STEPS.upload) {
      return 'שלב 1: העלאת קובץ ובחירת מבנה';
    }
    if (step === STEPS.mapping) {
      return 'שלב 2: מיפוי שדות';
    }
    if (step === STEPS.preview) {
      return 'שלב 3: תצוגה מקדימה ואימות';
    }
    return 'שלב 4: סיכום ואישור ייבוא';
  })();

  const canProceedFromUpload = hasColumns && Boolean(structureChoice);

  const currentStepIndex = STEP_SEQUENCE.indexOf(step);
  const canGoBack = currentStepIndex > 0;

  const handleBack = () => {
    if (!canGoBack) {
      return;
    }
    const previousStep = STEP_SEQUENCE[currentStepIndex - 1];
    setStep(previousStep);
  };

  const handleNext = () => {
    if (step === STEPS.welcome) {
      setStep(STEPS.upload);
      return;
    }

    if (step === STEPS.upload && canProceedFromUpload) {
      setStep(STEPS.mapping);
      return;
    }

    if (step === STEPS.mapping) {
      handleProceedToConfirm();
      return;
    }

    if (step === STEPS.preview) {
      setStep(STEPS.confirm);
      return;
    }

    if (step === STEPS.confirm) {
      handleSubmit();
    }
  };

  const nextDisabled = (() => {
    if (step === STEPS.upload) {
      return !canProceedFromUpload;
    }
    if (step === STEPS.mapping) {
      return !canAdvanceFromMapping;
    }
    if (step === STEPS.confirm) {
      return isSubmitting;
    }
    return false;
  })();

  const nextLabel = (() => {
    if (step === STEPS.preview) {
      return 'המשך';
    }
    if (step === STEPS.confirm) {
      return isSubmitting ? 'מייבא...' : 'אישור וייבוא';
    }
    return 'הבא';
  })();

  const footer = (
    <div className="legacy-import-footer">
      {canGoBack ? (
        <Button type="button" variant="ghost" onClick={handleBack} className="legacy-import-row-reverse gap-2 rtl-embed-text">
          <ArrowRight className="h-4 w-4" aria-hidden="true" /> חזור
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        {step === STEPS.confirm ? (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="legacy-import-row-reverse gap-2 rtl-embed-text"
          >
            {isSubmitting ? (
              <>
                <Upload className="h-4 w-4 animate-spin" aria-hidden="true" />
                מייבא...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                אישור וייבוא
              </>
            )}
          </Button>
        ) : null}
        {step !== STEPS.confirm ? (
          <Button
            type="button"
            onClick={handleNext}
            disabled={nextDisabled}
            className="legacy-import-row-reverse gap-2 rtl-embed-text"
          >
            {step === STEPS.mapping ? <ArrowLeft className="h-4 w-4" aria-hidden="true" /> : null}
            {nextLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );

  const handleDialogChange = (nextOpen) => {
    if (!nextOpen) {
      // Dialog is trying to close. On mobile, this might fire BEFORE Select's onOpenChange(false).
      // Add a small delay to let Select update the ref first.
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }

      closeTimeoutRef.current = setTimeout(() => {
        if (openSelectCountRef.current === 0 && onClose) {
          onClose();
        }
      }, 50); // 50ms delay to let Select close event process
    }
  };

  // Prevent Dialog from closing if any Select is currently open.
  const handleDialogInteractOutside = (event) => {
    if (openSelectCountRef.current > 0 || isClosingSelectRef.current) {
      event.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent
        className="legacy-import-dialog-content overflow-y-auto sm:max-w-3xl"
        onInteractOutside={handleDialogInteractOutside}
        footer={footer}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground rtl-embed-text">{title}</DialogTitle>
          {studentName ? (
            <p className="text-sm text-neutral-600 rtl-embed-text">תלמיד: {studentName}</p>
          ) : null}
        </DialogHeader>
        <div className="space-y-4">
          {step === STEPS.welcome ? renderWarningStep() : null}
          {step === STEPS.upload ? renderUploadStep() : null}
          {step === STEPS.mapping ? renderMappingStep() : null}
          {step === STEPS.preview ? renderPreviewStep() : null}
          {step === STEPS.confirm ? renderConfirmStep() : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
