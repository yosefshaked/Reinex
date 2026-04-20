import { useEffect, useMemo, useRef, useState } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import { Grip, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.jsx';
import { useServices } from '@/hooks/useOrgData.js';

function normalizePositiveDuration(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  return Math.round(minutes);
}

function toDurationString(totalMinutes) {
  const minutes = normalizePositiveDuration(totalMinutes);
  if (!minutes) {
    return '00:15';
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export default function CalendarServicePalette() {
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { services, isLoading, error } = useServices();

  const activeServices = useMemo(
    () => (Array.isArray(services) ? services : [])
      .filter((service) => service?.is_active === true)
      .map((service) => {
        const durationMinutes = normalizePositiveDuration(service?.duration_minutes);
        return {
          ...service,
          displayName: service?.service_name || service?.name || 'שירות',
          durationMinutes,
        };
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'he')),
    [services],
  );

  const filteredServices = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return activeServices;
    }

    return activeServices.filter((service) => (
      service.displayName.toLowerCase().includes(normalizedSearch)
      || String(service?.description || '').toLowerCase().includes(normalizedSearch)
    ));
  }, [activeServices, search]);

  useEffect(() => {
    if (!open || !containerRef.current) {
      return undefined;
    }

    const draggable = new Draggable(containerRef.current, {
      itemSelector: '.calendar-service-drag-item',
      eventData(eventEl) {
        const durationMinutes = Number(eventEl.getAttribute('data-service-duration-minutes')) || 0;
        return {
          title: eventEl.getAttribute('data-service-name') || 'שירות',
          duration: toDurationString(durationMinutes),
          classNames: ['reinex-calendar-external-preview'],
          extendedProps: {
            previewKind: 'service_drop',
            serviceDurationMinutes: durationMinutes,
            serviceColor: eventEl.getAttribute('data-service-color') || '',
          },
          create: false,
        };
      },
    });

    return () => {
      draggable.destroy();
    };
  }, [open, filteredServices]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={open ? 'default' : 'outline'}
            className="w-full justify-between"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              יצירה משירות לגרירה
            </span>
            <Badge variant="secondary" className={open ? 'bg-white/20 text-white hover:bg-white/20' : ''}>
              {activeServices.length}
            </Badge>
          </Button>
        </PopoverTrigger>

        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={10}
          className="w-[22rem] rounded-2xl border border-slate-200 bg-slate-50 p-0 shadow-2xl"
        >
          <div className="border-b border-slate-200 bg-white px-4 py-4">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                {activeServices.length} שירותים
              </Badge>
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900">גרירת שירותים ללוח</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              בחרו שירות, גררו למשבצת של מדריך/ה ושעה, ואז השלימו את פרטי השיעור בחלון הקיים.
            </p>
          </div>

          <div className="p-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="חיפוש שירות..."
              className="bg-white"
            />
          </div>

          <div ref={containerRef} className="max-h-[24rem] space-y-2 overflow-y-auto px-4 pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-6 text-sm text-slate-500">
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                טוען שירותים...
              </div>
            ) : null}

            {!isLoading && error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-4 text-sm text-red-700">
                {String(error)}
              </div>
            ) : null}

            {!isLoading && !error && filteredServices.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                לא נמצאו שירותים תואמים.
              </div>
            ) : null}

            {!isLoading && !error ? filteredServices.map((service) => {
              const isDraggable = Boolean(service.durationMinutes);
              return (
                <div
                  key={service.id}
                  className={`${isDraggable ? 'calendar-service-drag-item' : ''} rounded-2xl border bg-white px-4 py-4 shadow-sm transition ${isDraggable ? 'cursor-grab border-slate-200 hover:border-slate-300 hover:shadow-md active:cursor-grabbing' : 'cursor-not-allowed border-red-200 opacity-60'}`.trim()}
                  data-service-id={String(service.id)}
                  data-service-name={service.displayName}
                  data-service-duration-minutes={service.durationMinutes || ''}
                  data-service-color={service?.color || ''}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {service?.color ? (
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 rounded-full border border-slate-200"
                            style={{ backgroundColor: service.color }}
                          />
                        ) : null}
                        <div className="truncate text-sm font-medium text-slate-900">{service.displayName}</div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {service.durationMinutes ? `${service.durationMinutes} דקות` : 'לשירות אין משך תקין'}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 text-slate-400">
                      <Grip className="h-4 w-4" />
                      <span className="text-[11px]">גרירה</span>
                    </div>
                  </div>
                </div>
              );
            }) : null}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
