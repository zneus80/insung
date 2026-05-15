'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const goalSchema = z.object({
  title: z.string().min(2, '목표명을 2자 이상 입력하세요').max(100),
  description: z.string().min(5, '세부추진내용을 5자 이상 입력하세요'),
  dueDate: z.string().min(1, '추진기한을 선택하세요'),
});

export type GoalFormValues = z.infer<typeof goalSchema>;

interface GoalFormProps {
  defaultValues?: Partial<GoalFormValues>;
  onSubmit: (values: GoalFormValues) => Promise<void>;
  submitLabel?: string;
  isLoading?: boolean;
}

export default function GoalForm({
  defaultValues,
  onSubmit,
  submitLabel = '저장',
  isLoading = false,
}: GoalFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GoalFormValues>({
    resolver: zodResolver(goalSchema),
    defaultValues,
  });

  // defaultValues가 비동기로 로드되는 경우(edit 모드) 폼 값 동기화
  useEffect(() => {
    if (defaultValues && Object.keys(defaultValues).length > 0) {
      reset(defaultValues);
    }
  }, [JSON.stringify(defaultValues)]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* 목표명 */}
      <div className="space-y-1.5">
        <Label htmlFor="title">
          목표명 <span className="text-red-500">*</span>
        </Label>
        <Input
          id="title"
          placeholder="예) 신제품 출시 일정 준수"
          {...register('title')}
        />
        {errors.title && (
          <p className="text-xs text-red-500">{errors.title.message}</p>
        )}
      </div>

      {/* 세부추진내용 */}
      <div className="space-y-1.5">
        <Label htmlFor="description">
          세부추진내용 <span className="text-red-500">*</span>
        </Label>
        <Textarea
          id="description"
          rows={4}
          placeholder="구체적인 실행 계획을 입력하세요"
          {...register('description')}
        />
        {errors.description && (
          <p className="text-xs text-red-500">{errors.description.message}</p>
        )}
      </div>

      {/* 추진기한 */}
      <div className="space-y-1.5">
        <Label htmlFor="dueDate">
          추진기한 <span className="text-red-500">*</span>
        </Label>
        <Input id="dueDate" type="date" {...register('dueDate')} />
        {errors.dueDate && (
          <p className="text-xs text-red-500">{errors.dueDate.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? '저장 중...' : submitLabel}
      </Button>
    </form>
  );
}
