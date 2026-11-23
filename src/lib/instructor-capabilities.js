/**
 * The full capability set to send when one service's scheduling changes. The endpoint replaces the
 * whole set, so every other service goes back exactly as it was; a service the employee was not yet
 * assigned to is added, which is how the office assigns it from the service card.
 */
export function buildCapabilitiesPayload(capabilities, { serviceId, maxStudents, availabilityWindows }) {
  const existing = Array.isArray(capabilities) ? capabilities : [];
  const rows = existing.map((capability) => ({
    service_id: capability.service_id,
    max_students: capability.service_id === serviceId ? maxStudents : (capability.max_students || 1),
    availability_windows: capability.service_id === serviceId
      ? availabilityWindows
      : (capability.availability_windows || []),
  }));
  if (!existing.some((capability) => capability.service_id === serviceId)) {
    rows.push({ service_id: serviceId, max_students: maxStudents, availability_windows: availabilityWindows });
  }
  return rows;
}
