import type { CreateBookInput } from '@caiwu/core';
import BookPicker from '../../../modules/books/web/BookPicker';
import type { TemplateCreation } from '../../../modules/books/web/template-creation';
import TemplateCreationFields from '../../../modules/templates/web/TemplateCreationFields';
import { assertTemplateCreation } from '../../../modules/templates/creation-policy';
import {
  TemplateCreationCheckSchema,
  TemplateFactsSchema,
} from '../../../modules/templates/shared';

export const templateCreation: TemplateCreation = {
  Fields({ value, onChange, ...props }) {
    const parsed = TemplateFactsSchema.safeParse(value);
    return (
      <TemplateCreationFields
        {...props}
        value={parsed.success ? parsed.data : undefined}
        onChange={(facts) => onChange?.(facts)}
      />
    );
  },
  validate(input: CreateBookInput) {
    assertTemplateCreation(TemplateCreationCheckSchema.parse(input));
  },
};

export function BookPickerWithTemplateCreation() {
  return <BookPicker templateCreation={templateCreation} />;
}
