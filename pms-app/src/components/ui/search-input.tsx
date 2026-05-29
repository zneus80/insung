'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchInputProps extends Omit<React.ComponentProps<'input'>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  /** 좌측 돋보기 아이콘 표시 (기본 false). 기존 검색 UI 와 시각적 호환 위해 옵션. */
  showSearchIcon?: boolean;
}

/**
 * 검색 입력창 — 값이 있을 때 우측에 X 클리어 버튼 노출.
 * 기존 Input 스타일을 그대로 따르고 오른쪽 패딩만 확보.
 */
export function SearchInput({ value, onChange, showSearchIcon = false, className, ...rest }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      {showSearchIcon && (
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
      )}
      <Input
        {...rest}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(value ? 'pr-7' : '', showSearchIcon ? 'pl-7' : '')}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="검색어 지우기"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          tabIndex={-1}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
