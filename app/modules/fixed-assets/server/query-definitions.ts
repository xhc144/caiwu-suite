import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import { QuerySchema, queryConditionProblem } from '../shared';
import { parseQueryLogic } from '../query-logic';
import { fail } from './service';

type Definitions = {
  revision: number;
  items: { name: string; query: z.output<typeof QuerySchema> }[];
};
export function queryDefinitions(svc: CoreServices) {
  const key = `query-definitions:${svc.ctx.user.id}`;
  const self = {
    async list() {
      svc.permissions.require('fixed-assets.view');
      return svc.settings.get<Definitions>(key, { revision: 0, items: [] });
    },
    async save(input: { name: string; query: z.input<typeof QuerySchema>; revision: number }) {
      svc.permissions.require('fixed-assets.view');
      return svc.tx(async (ts) => {
        const current = await queryDefinitions(ts).list();
        if (input.revision !== current.revision)
          fail('QUERY_DEFINITION_STALE', '查询定义已被其他窗口修改', '刷新查询定义后重试');
        const query = QuerySchema.parse(input.query);
        for (const condition of query.conditions) {
          const problem = queryConditionProblem(condition);
          if (problem) fail(problem.code, problem.message, problem.hint);
        }
        try {
          parseQueryLogic(query.expression, query.conditions.length);
        } catch (e) {
          fail('QUERY_LOGIC', e instanceof Error ? e.message : '条件组合不正确');
        }
        const items = current.items.filter((x) => x.name !== input.name);
        if (items.length >= 20)
          fail(
            'QUERY_DEFINITION_LIMIT',
            '每位操作员最多保存 20 个查询定义',
            '请先删除不再使用的定义',
          );
        items.push({ name: input.name, query });
        await ts.settings.set(key, { revision: current.revision + 1, items });
      });
    },
    async remove(name: string, revision: number, confirm: boolean) {
      svc.permissions.require('fixed-assets.view');
      return svc.tx(async (ts) => {
        if (!confirm) fail('CONFIRM', '删除查询定义需要确认');
        const current = await queryDefinitions(ts).list();
        if (revision !== current.revision)
          fail('QUERY_DEFINITION_STALE', '查询定义已被其他窗口修改', '刷新后重试');
        await ts.settings.set(key, {
          revision: current.revision + 1,
          items: current.items.filter((x) => x.name !== name),
        });
      });
    },
  };
  return self;
}
