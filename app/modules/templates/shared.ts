import { z } from 'zod';
import { CreateBookInputSchema } from '@caiwu/core';

/** 来自会计人员对合同的判断，不根据企业名称、年份或模板自动代选。 */
export const TemplateFactsSchema = z
  .object({
    guaranteeStandard: z.enum(['cas22', 'cas25']).optional(),
    financialGuaranteeContract: z.boolean().optional(),
    designatedAtFairValue: z.boolean().optional(),
    previouslyAssertedInsurance: z.boolean().optional(),
    usedInsuranceAccounting: z.boolean().optional(),
    irrevocableContractElection: z.boolean().optional(),
    anhuiApprovedNutritionCanteen: z.boolean().optional(),
  })
  .strict();

export const TemplateCreationCheckSchema = CreateBookInputSchema.pick({
  templateId: true,
  startYear: true,
  startMonth: true,
}).extend({ facts: TemplateFactsSchema.optional() });

export const TemplateBookInputSchema = CreateBookInputSchema.extend({
  facts: TemplateFactsSchema.optional(),
});

export type TemplateFacts = z.infer<typeof TemplateFactsSchema>;
export type TemplateCreationCheck = z.input<typeof TemplateCreationCheckSchema>;
export type TemplateBookInput = z.input<typeof TemplateBookInputSchema>;

export type TemplateCreationPolicy = {
  templateId: string;
  effectiveFrom: string;
  effectiveThrough?: string;
  source: string;
  scope?: 'guarantee-cas22' | 'guarantee-cas25' | 'anhui-canteen' | 'reference-only';
};

export type TemplateCreationIssue = {
  code: 'TEMPLATE_DATE_INVALID' | 'TEMPLATE_SCOPE_REQUIRED' | 'TEMPLATE_REFERENCE_ONLY';
  field: 'startYear' | 'facts';
  message: string;
  hint: string;
};

export type TemplateCreationResult = {
  allowed: boolean;
  policy: TemplateCreationPolicy | null;
  issues: TemplateCreationIssue[];
};
