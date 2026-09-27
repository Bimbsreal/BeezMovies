import { PROTECTED_PRIORITY } from './constants.js';

export function priorityFor(source, field) {
  const override = source.fieldPriority?.[field];
  if (Number.isInteger(override)) return override;
  return source.priority;
}

export function shouldReplace({
  existingValue,
  incomingValue,
  existingPriority = null,
  incomingPriority,
  existingUpdatedAt = null,
  incomingUpdatedAt = null,
}) {
  if (incomingValue === null || incomingValue === undefined || incomingValue === '') return false;
  if (existingValue === null || existingValue === undefined || existingValue === '') return true;

  const currentPriority = existingPriority ?? PROTECTED_PRIORITY;
  if (incomingPriority > currentPriority) return true;
  if (incomingPriority < currentPriority) return false;

  const incomingTime = incomingUpdatedAt ? new Date(incomingUpdatedAt).getTime() : 0;
  const existingTime = existingUpdatedAt ? new Date(existingUpdatedAt).getTime() : 0;
  return incomingTime >= existingTime;
}
