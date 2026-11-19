'use client';
import { useLayoutEffect, useRef } from 'react';

// iOS standalone and browser chrome can disagree with CSS vh/dvh. Measure the
// actual visible height; update on rotation, browser toolbar and keyboard changes.
export function useAppViewport(inGame: boolean) {
  const app = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = app.current;
    if (!inGame || !element) return;
    let frame = 0;
    let measuredHeight = 0;
    let chatWasOpen = false;
    let keyboardSettled = 0;
    const measure = () => {
      const viewport = window.visualViewport;
      // Do not reflow the table while the user pinch-zooms it.
      if (viewport && Math.abs(viewport.scale - 1) > .01) return;
      const height = viewport?.height || window.innerHeight;
      const chatOpen = element.classList.contains('chat-active');
      if (chatOpen) {
        chatWasOpen = true;
        window.clearTimeout(keyboardSettled);
        if (measuredHeight) return;
      } else if (chatWasOpen && measuredHeight - height > 100) {
        // Keyboard dismissal can finish after React has removed the overlay.
        window.clearTimeout(keyboardSettled);
        keyboardSettled = window.setTimeout(() => { chatWasOpen = false; measure(); }, 500);
        return;
      }
      if (!chatOpen) chatWasOpen = false;
      measuredHeight = height;
      element.style.setProperty('--app-viewport-top', `${Math.max(0, viewport?.offsetTop || 0)}px`);
      element.style.setProperty('--app-viewport-left', `${Math.max(0, viewport?.offsetLeft || 0)}px`);
      if (height > 0) element.style.setProperty('--app-viewport-height', `${Math.floor(height)}px`);
    };
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const reorient = () => {
      // iOS often reports the old visual viewport once immediately after rotating.
      resize();
      window.setTimeout(resize, 80);
      window.setTimeout(() => {
        window.scrollTo(0, 0);
        resize();
      }, 260);
    };
    const observer = new MutationObserver(resize);
    observer.observe(element, { attributes: true, attributeFilter: ['class'] });
    measure();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', reorient);
    window.addEventListener('pageshow', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(keyboardSettled);
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', reorient);
      window.removeEventListener('pageshow', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
      element.style.removeProperty('--app-viewport-height');
      element.style.removeProperty('--app-viewport-top');
      element.style.removeProperty('--app-viewport-left');
    };
  }, [inGame]);
  return app;
}
