import { Alert, Checkbox, Radio, Space, Typography } from 'antd';
import { checkTemplateCreation, templateCreationPolicies } from '../creation-policy';
import {
  TemplateCreationCheckSchema,
  type TemplateCreationResult,
  type TemplateFacts,
} from '../shared';

/** 建账宿主传入同一组年月及事实；只收集明确选择，提交仍须服务端复检。 */
export default function TemplateCreationFields({
  templateId,
  startYear,
  startMonth,
  value,
  onChange,
}: {
  templateId: string;
  startYear: number;
  startMonth: number;
  value?: TemplateFacts;
  onChange: (facts: TemplateFacts) => void;
}) {
  const parsed = TemplateCreationCheckSchema.safeParse({
    templateId,
    startYear,
    startMonth,
    facts: value,
  });
  const result: TemplateCreationResult = parsed.success
    ? checkTemplateCreation(parsed.data)
    : {
        allowed: false,
        policy: templateCreationPolicies.find((p) => p.templateId === templateId) ?? null,
        issues: [
          {
            code: 'TEMPLATE_DATE_INVALID',
            field: 'startYear',
            message: '请填写有效的启用年份和月份',
            hint: '年份须为2000至2100年，月份须为1至12月',
          },
        ],
      };
  const scope = result.policy?.scope;
  const guarantee = scope === 'guarantee-cas22' || scope === 'guarantee-cas25';
  const update = (key: keyof TemplateFacts, checked: boolean) =>
    onChange({ ...value, [key]: checked });
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      {result.policy && (
        <Typography.Text>本版本适用起始日：{result.policy.effectiveFrom}</Typography.Text>
      )}
      {guarantee && (
        <>
          <Typography.Text>请按相关单项合同的核算选择填写；模板不会代作会计判断。</Typography.Text>
          <Radio.Group
            aria-label="财务担保合同核算准则"
            value={value?.guaranteeStandard}
            onChange={(e) =>
              onChange({ ...value, guaranteeStandard: e.target.value as 'cas22' | 'cas25' })
            }
          >
            <Space orientation="vertical">
              <Radio value="cas22">金融工具确认和计量准则</Radio>
              <Radio value="cas25">保险合同准则</Radio>
            </Space>
          </Radio.Group>
          <Checkbox
            checked={value?.financialGuaranteeContract === true}
            onChange={(e) => update('financialGuaranteeContract', e.target.checked)}
          >
            已核实相关合同属于财务担保合同
          </Checkbox>
          <Checkbox
            checked={value?.designatedAtFairValue === false}
            onChange={(e) => update('designatedAtFairValue', !e.target.checked)}
          >
            未指定为以公允价值计量且其变动计入当期损益
          </Checkbox>
          {scope === 'guarantee-cas25' && (
            <>
              <Checkbox
                checked={value?.previouslyAssertedInsurance === true}
                onChange={(e) => update('previouslyAssertedInsurance', e.target.checked)}
              >
                发行方之前已明确将此类合同视作保险合同
              </Checkbox>
              <Checkbox
                checked={value?.usedInsuranceAccounting === true}
                onChange={(e) => update('usedInsuranceAccounting', e.target.checked)}
              >
                已按保险合同相关准则进行会计处理
              </Checkbox>
              <Checkbox
                checked={value?.irrevocableContractElection === true}
                onChange={(e) => update('irrevocableContractElection', e.target.checked)}
              >
                相关单项合同已作出不可撤销的保险合同准则选择
              </Checkbox>
            </>
          )}
        </>
      )}
      {scope === 'anhui-canteen' && (
        <Checkbox
          checked={value?.anhuiApprovedNutritionCanteen === true}
          onChange={(e) => update('anhuiApprovedNutritionCanteen', e.target.checked)}
        >
          本食堂在安徽省，属于经政府批准实施学生营养改善计划的中小学校食堂
        </Checkbox>
      )}
      {result.issues.map((issue) => (
        <Alert
          key={issue.message}
          type="warning"
          showIcon
          title={issue.message}
          description={issue.hint}
        />
      ))}
    </Space>
  );
}
