/**
 * useGestures.ts
 * 触摸手势 Hook
 * 
 * 功能:
 * - 滑动手势检测
 * - 捏合缩放
 * - 长按检测
 * - 双击检测
 */

import { useRef, useCallback, useEffect } from 'react';

interface TouchPoint {
  x: number;
  y: number;
  timestamp: number;
}

interface GestureCallbacks {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onPinchStart?: () => void;
  onPinchEnd?: () => void;
  onPinch?: (scale: number) => void;
  onLongPress?: () => void;
  onDoubleTap?: () => void;
  onTap?: () => void;
  swipeThreshold?: number;
  longPressDelay?: number;
  doubleTapDelay?: number;
}

const DEFAULT_SWIPE_THRESHOLD = 50;
const DEFAULT_LONG_PRESS_DELAY = 500;
const DEFAULT_DOUBLE_TAP_DELAY = 300;

export function useGestures(callbacks: GestureCallbacks) {
  const elementRef = useRef<HTMLElement | null>(null);
  const touchStartRef = useRef<TouchPoint | null>(null);
  const lastTapRef = useRef<TouchPoint | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialPinchDistanceRef = useRef<number | null>(null);
  
  const swipeThreshold = callbacks.swipeThreshold ?? DEFAULT_SWIPE_THRESHOLD;
  const longPressDelay = callbacks.longPressDelay ?? DEFAULT_LONG_PRESS_DELAY;
  const doubleTapDelay = callbacks.doubleTapDelay ?? DEFAULT_DOUBLE_TAP_DELAY;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      timestamp: Date.now(),
    };

    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      callbacks.onLongPress?.();
    }, longPressDelay);

    if (e.touches.length === 2) {
      const touch0 = e.touches[0];
      const touch1 = e.touches[1];
      if (touch0 && touch1) {
        const dx = touch0.clientX - touch1.clientX;
        const dy = touch0.clientY - touch1.clientY;
        initialPinchDistanceRef.current = Math.sqrt(dx * dx + dy * dy);
        callbacks.onPinchStart?.();
      }
    }
  }, [callbacks, longPressDelay, clearLongPressTimer]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;

    const touch = e.touches[0];
    if (!touch) return;
    
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 10) {
      clearLongPressTimer();
    }

    if (e.touches.length === 2 && initialPinchDistanceRef.current) {
      const touch0 = e.touches[0];
      const touch1 = e.touches[1];
      if (touch0 && touch1) {
        const currentDx = touch0.clientX - touch1.clientX;
        const currentDy = touch0.clientY - touch1.clientY;
        const currentDistance = Math.sqrt(currentDx * currentDx + currentDy * currentDy);
        const scale = currentDistance / initialPinchDistanceRef.current;
        callbacks.onPinch?.(scale);
      }
    }
  }, [callbacks, clearLongPressTimer]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    clearLongPressTimer();

    if (e.touches.length === 0 && initialPinchDistanceRef.current) {
      initialPinchDistanceRef.current = null;
      callbacks.onPinchEnd?.();
    }

    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    if (!touch) return;
    
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    const isTap = absDx < 10 && absDy < 10;
    
    if (isTap) {
      const now = Date.now();
      const lastTap = lastTapRef.current;

      if (lastTap && now - lastTap.timestamp < doubleTapDelay) {
        callbacks.onDoubleTap?.();
        lastTapRef.current = null;
        touchStartRef.current = null;
        return;
      }

      lastTapRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        timestamp: now,
      };

      setTimeout(() => {
        if (lastTapRef.current && Date.now() - lastTapRef.current!.timestamp >= doubleTapDelay - 50) {
          callbacks.onTap?.();
          lastTapRef.current = null;
        }
      }, doubleTapDelay);
    } else if (absDx > swipeThreshold || absDy > swipeThreshold) {
      if (absDx > absDy) {
        if (dx > 0) {
          callbacks.onSwipeRight?.();
        } else {
          callbacks.onSwipeLeft?.();
        }
      } else {
        if (dy > 0) {
          callbacks.onSwipeDown?.();
        } else {
          callbacks.onSwipeUp?.();
        }
      }
    }

    touchStartRef.current = null;
  }, [callbacks, swipeThreshold, doubleTapDelay, clearLongPressTimer]);

  const ref = useCallback((element: HTMLElement | null) => {
    if (elementRef.current) {
      elementRef.current.removeEventListener('touchstart', handleTouchStart);
      elementRef.current.removeEventListener('touchmove', handleTouchMove);
      elementRef.current.removeEventListener('touchend', handleTouchEnd);
    }

    elementRef.current = element;

    if (element) {
      element.addEventListener('touchstart', handleTouchStart, { passive: true });
      element.addEventListener('touchmove', handleTouchMove, { passive: true });
      element.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  return { ref };
}

export function useSwipeGesture(
  onSwipe: (direction: 'left' | 'right' | 'up' | 'down') => void,
  threshold = DEFAULT_SWIPE_THRESHOLD
) {
  const elementRef = useRef<HTMLElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    if (!touch) return;
    
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx > threshold || absDy > threshold) {
      if (absDx > absDy) {
        onSwipe(dx > 0 ? 'right' : 'left');
      } else {
        onSwipe(dy > 0 ? 'down' : 'up');
      }
    }

    touchStartRef.current = null;
  }, [onSwipe, threshold]);

  const ref = useCallback((element: HTMLElement | null) => {
    if (elementRef.current) {
      elementRef.current.removeEventListener('touchstart', handleTouchStart);
      elementRef.current.removeEventListener('touchend', handleTouchEnd);
    }

    elementRef.current = element;

    if (element) {
      element.addEventListener('touchstart', handleTouchStart, { passive: true });
      element.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
  }, [handleTouchStart, handleTouchEnd]);

  return { ref };
}

export function useLongPress(
  callback: () => void,
  delay = DEFAULT_LONG_PRESS_DELAY
) {
  const elementRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const start = useCallback(() => {
    timerRef.current = setTimeout(callback, delay);
  }, [callback, delay]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const ref = useCallback((element: HTMLElement | null) => {
    if (elementRef.current) {
      elementRef.current.removeEventListener('touchstart', start);
      elementRef.current.removeEventListener('touchend', stop);
      elementRef.current.removeEventListener('touchmove', stop);
      elementRef.current.removeEventListener('touchcancel', stop);
    }

    elementRef.current = element;

    if (element) {
      element.addEventListener('touchstart', start, { passive: true });
      element.addEventListener('touchend', stop, { passive: true });
      element.addEventListener('touchmove', stop, { passive: true });
      element.addEventListener('touchcancel', stop, { passive: true });
    }
  }, [start, stop]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { ref };
}
