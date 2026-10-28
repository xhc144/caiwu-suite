import type { RuntimeHooks } from '@caiwu/server-kit';
import { builtinTemplates } from '@caiwu/core/server';
import { parseTemplate } from '@caiwu/core';
import { resolveTemplatePresets, type TemplatePresetInput } from '../preset';

/** 全部模块的静态模板已登记后，复用启动钩子解析行业方案。 */
export function presetLifecycle(presets: readonly TemplatePresetInput[]): RuntimeHooks {
  return {
    async start({ app }) {
      const templates = resolveTemplatePresets(presets, (id) => app.templates.get(id));
      // 生产列表会隐藏演示模板；仍须检查它们的编号，不能等 register 写到半批才发现。
      const staticDefinitions = [
        ...builtinTemplates,
        ...app.modules.templates().flatMap((entry) => entry.templates),
      ];
      const existing = new Set([
        ...staticDefinitions.map((raw) => parseTemplate(raw).id),
        ...app.templates.list().map((template) => template.id),
      ]);
      for (const template of templates) {
        if (existing.has(template.id))
          throw new Error(`会计制度模板 ${template.id} 已经登记，行业方案不能覆盖`);
      }
      app.templates.register('templates-industry', templates);
    },
  };
}
