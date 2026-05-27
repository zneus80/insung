import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { KeyboardEvent } from "react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 입력창(Textarea/Input)에서 Shift+Enter 로 제출(버튼 입력)하는 onKeyDown 핸들러.
 * 일반 Enter 는 줄바꿈 그대로 유지. enabled=false 면 동작 안 함(필수값 미충족 등).
 *
 * 사용: <Textarea onKeyDown={shiftEnterSubmit(handleSave, !!value.trim())} />
 */
export function shiftEnterSubmit(onSubmit: () => void, enabled = true) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (enabled) onSubmit();
    }
  };
}
