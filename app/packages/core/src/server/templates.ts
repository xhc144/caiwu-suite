import { BusinessError } from '../errors';
import { parseTemplate, type AccountingTemplate } from '../template';
import type { TemplateSummary } from '../book';
import demoTemplate from '../../templates/demo.json' with { type: 'json' };

/** 核心自带的模板（只有开发测试用的演示科目表）。正式的会计制度模板由模块提供。 */
export const builtinTemplates: unknown[] = [demoTemplate];

/** 会计制度模板登记处。服务启动时把各模块声明的模板登记进来。 */
export class TemplateRegistry {
  readonly #templates = new Map<string, { template: AccountingTemplate; source: string }>();
  readonly devMode: boolean;

  constructor(opts: { devMode: boolean }) {
    this.devMode = opts.devMode;
  }

  /** source 是提供方（模块 id 或 "core"），用于报错。 */
  register(source: string, templates: readonly unknown[]): void {
    for (const raw of templates) {
      let t: AccountingTemplate;
      try {
        t = parseTemplate(raw);
      } catch (e) {
        throw new Error(`${source} 提供的会计制度模板不合法：${(e as Error).message}`, {
          cause: e,
        });
      }
      const existing = this.#templates.get(t.id);
      if (existing)
        throw new Error(`会计制度模板 ${t.id} 重复：${existing.source} 和 ${source} 都提供了`);
      this.#templates.set(t.id, { template: t, source });
    }
  }

  list(): TemplateSummary[] {
    return [...this.#templates.values()]
      .map((e) => e.template)
      .filter((t) => this.devMode || !t.devOnly)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((t) => ({
        id: t.id,
        version: t.version,
        name: t.name,
        regime: t.regime,
        description: t.description ?? null,
        order: t.order,
        status: t.status,
        codeScheme: t.codeScheme,
        devOnly: t.devOnly,
        accountCount: t.accounts.length,
      }));
  }

  get(id: string): AccountingTemplate {
    const e = this.#templates.get(id);
    if (!e || (e.template.devOnly && !this.devMode)) {
      throw new BusinessError({ code: 'TEMPLATE_NOT_FOUND', message: `会计制度模板 ${id} 不存在` });
    }
    return e.template;
  }
}
