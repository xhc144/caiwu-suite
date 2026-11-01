import type { ComponentType } from 'react';
import type { CreateBookInput } from '@caiwu/core';

/** 宿主注入制度模块能力，books 不跨模块引用实现。 */
export type TemplateCreation = {
  Fields: ComponentType<{
    templateId: string;
    startYear: number;
    startMonth: number;
    value?: CreateBookInput['facts'];
    onChange?: (facts: NonNullable<CreateBookInput['facts']>) => void;
  }>;
  validate: (input: CreateBookInput) => void;
};
