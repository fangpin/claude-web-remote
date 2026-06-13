export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function hasAppModifier(event: KeyboardEvent): boolean {
  const platform = navigator.platform.toLowerCase();
  const isApplePlatform = platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad');
  return isApplePlatform ? event.metaKey : event.ctrlKey;
}

export function isPlainSlash(event: KeyboardEvent): boolean {
  return event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
}
