import { describe, expect, it } from 'vitest';
import { parentCodeOf, parseCodeScheme, templateProblems } from '@caiwu/core';
import base from '../templates/enterprise.json';
import updates from '../templates/enterprise-updates.json';
import details from '../templates/enterprise-details.json';
import {
  bookTemplates,
  enterpriseChart,
  meaningForTemplate,
  rawEnterpriseAccounts,
} from '../chart';
import { mapChart, summarizeChart } from '../chart-scheme';
import { expectedEnterprise } from './expected-enterprise';
import { expectedEnterpriseUpdates } from './expected-enterprise-updates';

// 来自旧owner对a02.acd实际行的转录，冻结名称/编码，不从生产JSON生成期望。
const originalDetails =
  `221101工资 221102职工福利 221103社会保险费 221104住房公积金 221105工会经费 221106职工教育经费 221107非货币性福利 221108辞退福利 221109股份支付 222101应交增值税 22210101进项税额 22210102已交税金 22210103转出未交增值税 22210104减免税款 22210105销项税额 22210106出口退税 22210107进项税额转出 22210108出口抵减内销产品应纳税额 22210109转出多交增值税 22210110销项税额抵减 222102未交增值税 222104应交消费税 222105应交资源税 222106应交所得税 222107应交土地增值税 222108应交城市维护建设税 222109应交房产税 222110应交土地使用税 222111应交车船使用税 222112应交个人所得税 222113其他应交款 22211301教育费附加 22211304地方教育费附加 222114预交增值税 222115待抵扣进项税额 222116待认证进项税额 222117待转销项税额 222118增值税留抵税额 222119简易计税 222120转让金融商品应交增值税 222121代扣代交增值税`.split(
    ' ',
  );

describe('w_xt_kgzb_a2/a3 企业完整官方表及正式增补', () => {
  it('2006全部156项独立逐项比较编码、名称、类别、方向、备抵、余额及结转性质', () => {
    expect(base.accounts).toHaveLength(156);
    expect(
      base.accounts.map((a) => [
        a.code,
        a.name,
        a.category,
        a.direction,
        a.contra,
        a.balanceNature,
        a.closingRule,
      ]),
    ).toEqual(expectedEnterprise.map((row) => row.slice(0, 7)));
    for (const [index, row] of expectedEnterprise.entries()) {
      const source = base.accounts[index]!.source;
      expect(source).toContain(`一级表第${row[7]}页第${index + 1}项`);
      expect(source).toContain(`${row[0]}科目说明第${row[8]}页`);
    }
    expect(new Set(base.accounts.map((a) => a.category))).toEqual(
      new Set(['asset', 'liability', 'common', 'equity', 'cost', 'pnl']),
    );
    expect(base.accounts.find((a) => a.code === '5402')?.contra).toBe(true);
    for (const [code, name, category, direction, contra, balance, closing] of expectedEnterprise) {
      const nature = ['profit', 'retained-earnings', 'year-retained-earnings', 'clearing'].includes(
        closing,
      )
        ? 'no-closing-balance'
        : balance === 'two-sided'
          ? 'both'
          : direction;
      expect(enterpriseChart.accounts.find((account) => account.code === code)).toMatchObject({
        name: code === '6403' ? '税金及附加' : name,
        category,
        direction,
        isContra: contra,
        balanceNature: nature,
        closingRule: closing,
      });
    }
  });
  it('47项后续一级逐项匹配独立期望，编号由软件设置，来源逐项保留有效文件及条款', () => {
    expect(
      updates
        .filter((a) => a.code.length === 4)
        .map((a) => [a.code, a.name, a.category, a.direction, a.contra]),
    ).toEqual(expectedEnterpriseUpdates.map((row) => row.slice(0, 5)));
    expect(updates.filter((a) => a.code.length > 4).map((a) => a.code)).toEqual([
      '400401',
      '400402',
      '400403',
      '400404',
    ]);
    for (const account of updates) {
      expect(account.needsReview).toBe(false);
      expect(account.source).toMatch(/财会〔\d{4}〕\d+号/);
      expect(account.source).toMatch(/汇编2024|财会〔/);
    }
    const compensation = updates.find((a) => a.code === '1485')!;
    expect(compensation.name).toBe('补偿性资产');
    expect(compensation.source).toContain('财会〔2025〕32号');
    expect(compensation.source).toContain('自行设置1485');
    expect(compensation.source).toContain('2026年1月1日');
    expect(enterpriseChart.sources.some((s) => s.title.includes('解释第20号'))).toBe(true);
    expect(enterpriseChart.sources.every((s) => !s.title.includes('征求意见'))).toBe(true);
    for (const [code, name, category, direction, isContra] of expectedEnterpriseUpdates)
      expect(enterpriseChart.accounts.find((account) => account.code === code)).toMatchObject({
        name,
        category,
        direction,
        isContra,
      });
  });
  it('原版41项薪酬税费明细保留原编码名称，增值税借贷方向依据正式2016规定', () => {
    expect(details.map((a) => a.code + a.name)).toEqual(originalDetails);
    for (const account of details)
      expect(account.source).toContain(`kmbm.txt实际行 ${account.code}`);
    for (const code of [
      '22210101',
      '22210102',
      '22210103',
      '22210104',
      '22210108',
      '22210110',
      '222114',
      '222115',
      '222116',
      '222118',
    ])
      expect(details.find((a) => a.code === code)?.direction).toBe('debit');
    for (const code of [
      '22210105',
      '22210106',
      '22210107',
      '22210109',
      '222117',
      '222119',
      '222120',
      '222121',
    ])
      expect(details.find((a) => a.code === code)?.direction).toBe('credit');
  });
  it.each(['4-2-2', '4-3-3'])(
    '登记/预览/提交校验使用248项同一集合，完整父链及核算属性不丢：%s',
    (scheme) => {
      const mapped = mapChart(enterpriseChart, scheme);
      const preview = summarizeChart(enterpriseChart, scheme);
      expect(preview.primaryCount).toBe(203);
      expect(preview.detailCount).toBe(45);
      expect(preview.accounts).toHaveLength(248);
      expect(preview.accounts).toEqual(mapped.accounts);
      expect(templateProblems(mapped)).toEqual([]);
      const codes = new Set(mapped.accounts.map((a) => a.code));
      expect(codes.size).toBe(248);
      for (const account of mapped.accounts) {
        const parent = parentCodeOf(account.code, parseCodeScheme(scheme));
        if (parent) expect(codes.has(parent)).toBe(true);
        expect(account.needsReview).toBe(false);
        expect(account.sourceVersion).toBeTruthy();
        expect(account.source).toBeTruthy();
      }
      const rows = meaningForTemplate(enterpriseChart.id, scheme);
      expect(rows.map((row) => row.originalCode)).toEqual(rawEnterpriseAccounts.map((a) => a.code));
      expect(rows.find((a) => a.originalCode === '22210101')?.code).toBe(
        scheme === '4-2-2' ? '22210101' : '2221001001',
      );
      expect(rows.find((a) => a.originalCode === '221101')?.code).toBe(
        scheme === '4-2-2' ? '221101' : '2211001',
      );
      expect(mapped.accounts.find((a) => a.code === '3001')?.balanceNature).toBe('both');
      expect(mapped.accounts.find((a) => a.code === '6001')?.balanceNature).toBe(
        'no-closing-balance',
      );
      expect(mapped.accounts.find((a) => a.code === '6403')?.name).toBe('税金及附加');
      expect(mapped.accounts.find((a) => a.code === '5402')?.isContra).toBe(true);
    },
  );
  it('两个制度原生模板登记，不复制建账器、不登记级次变体或九项样例', () => {
    expect(bookTemplates.map((t) => t.id)).toEqual([
      'books-enterprise-cas-2006',
      'books-small-business',
    ]);
    expect(enterpriseChart.version).toBe('2006.18+2026.2');
    expect(meaningForTemplate('books-enterprise-review', '4-2-2')).toEqual([]);
    expect(enterpriseChart.accounts.every((a) => !a.source?.includes('待核'))).toBe(true);
  });
});
