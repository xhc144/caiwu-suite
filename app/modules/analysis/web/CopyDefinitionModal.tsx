import { useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { coreApi, showError, useSubmission } from '@caiwu/web-kit';
import { CopyDefinitionSchema } from '../copy';
import { api } from './api';

export default function CopyDefinitionModal({
  onClose,
  onCopied,
}: {
  onClose: () => void;
  onCopied: () => void;
}) {
  const books = useQuery(coreApi.books.list.queryOptions());
  const [bookId, setBookId] = useState('');
  const [userCode, setUserCode] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [definitionId, setDefinitionId] = useState<number>();
  const [error, setError] = useState('');
  const source = useMutation(api.definitions.sources.mutationOptions({ meta: { silent: true } }));
  const copy = useMutation(api.definitions.copy.mutationOptions({ meta: { silent: true } }));
  const { submit, isSubmitting } = useSubmission();
  const resetSource = () => {
    source.reset();
    setDefinitionId(undefined);
    setError('');
  };
  const load = () =>
    submit(async () => {
      try {
        await source.mutateAsync({ bookId, userCode, password });
        setDefinitionId(undefined);
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : '来源读取失败');
      }
    });
  const save = () =>
    submit(async () => {
      const selected = source.data?.find((d) => d.id === definitionId);
      const parsed = CopyDefinitionSchema.safeParse({
        source: { bookId, userCode, password },
        definitionId,
        sourceRevision: selected?.revision,
        code,
        name,
      });
      if (!parsed.success) {
        setError(parsed.error.issues.map((i) => i.message).join('；'));
        return;
      }
      try {
        await copy.mutateAsync(parsed.data);
        setPassword('');
        onCopied();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : '复制失败，输入仍保留');
      }
    });
  return (
    <Modal
      open
      title="从账套复制分析表"
      onCancel={isSubmitting ? undefined : onClose}
      maskClosable={false}
      footer={
        <Space>
          <Button disabled={isSubmitting} onClick={onClose}>
            取消复制
          </Button>
          <Button
            type="primary"
            loading={isSubmitting}
            disabled={!definitionId}
            onClick={() => void save().catch(showError)}
          >
            确认复制到当前账套
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Alert type="info" title="验证来源账套操作员后读取分析定义；复制后请按当前账套检查科目。" />
        {error && <Alert type="error" title="复制未完成，输入仍保留" description={error} />}
        <label>来源账套</label>
        <Select
          aria-label="来源账套"
          style={{ width: '100%' }}
          value={bookId || undefined}
          loading={books.isFetching}
          disabled={isSubmitting}
          options={books.data?.map((b) => ({ value: b.id, label: b.name }))}
          onChange={(v) => {
            setBookId(v);
            setUserCode('');
            setPassword('');
            resetSource();
          }}
        />
        <Input
          aria-label="来源操作员编号"
          placeholder="来源账套操作员编号"
          value={userCode}
          disabled={isSubmitting}
          autoComplete="off"
          onChange={(e) => {
            setUserCode(e.target.value);
            resetSource();
          }}
        />
        <Input.Password
          aria-label="来源操作员密码"
          placeholder="来源账套操作员密码"
          value={password}
          disabled={isSubmitting}
          autoComplete="new-password"
          onChange={(e) => {
            setPassword(e.target.value);
            resetSource();
          }}
        />
        <Button
          disabled={!bookId || !userCode}
          loading={isSubmitting}
          onClick={() => void load().catch(showError)}
        >
          读取来源分析表
        </Button>
        {source.data && source.data.length === 0 && (
          <Alert type="info" title="来源账套尚无自定义分析表" />
        )}
        <Select
          aria-label="来源分析表"
          style={{ width: '100%' }}
          value={definitionId}
          disabled={!source.data || isSubmitting}
          options={source.data?.map((d) => ({ value: d.id, label: `${d.code} ${d.name}` }))}
          onChange={(v) => {
            setDefinitionId(v);
            setName(source.data?.find((d) => d.id === v)?.name ?? '');
          }}
        />
        <Input
          aria-label="复制后分析编号"
          placeholder="新分析编号（1至3位数字）"
          value={code}
          maxLength={3}
          disabled={isSubmitting}
          onChange={(e) => setCode(e.target.value)}
        />
        <Input
          aria-label="复制后分析名称"
          placeholder="新分析名称"
          value={name}
          maxLength={80}
          disabled={isSubmitting}
          onChange={(e) => setName(e.target.value)}
        />
      </Space>
    </Modal>
  );
}
