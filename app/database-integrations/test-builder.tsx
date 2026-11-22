'use client';
import {useState, type FormEvent} from 'react';

type Source = {id: string; name: string; version: string};

export default function TestBuilder({sources}: {sources: Source[]}) {
  const [kind, setKind] = useState('text');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  if (!sources.length) return null;
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const read = (key: string) => String(fields.get(key) ?? '').trim();
    const source = sources.find(item => item.id === read('source'));
    if (!source) return;
    try {
      const pointer = (name: string) => {
        const value = read(name);
        if (value && (!value.startsWith('/') || /~(?![01])/.test(value))) throw Error('Field paths must be JSON Pointers such as /decision or /sensor/value.');
        return value;
      };
      const expected = kind === 'text' ? JSON.stringify(String(fields.get('expected') ?? '')) : read('expected');
      if (kind === 'number' && (typeof JSON.parse(expected) !== 'number' || !Number.isFinite(Number(expected)))) throw Error('Enter a finite JSON number.');
      const rule = kind === 'range' ? {minimum: read('minimum'), maximum: read('maximum')} : {expected};
      if (kind === 'range' && Number(rule.minimum) > Number(rule.maximum)) throw Error('The minimum must be at or below the maximum.');
      const resourcePointer = pointer('identity');
      const instance = read('instance');
      if (!!resourcePointer !== !!instance) throw Error('For resource findings, enter both the identity field and a stable source instance.');
      const definition = {format: 'regpilot-source-test-v1', definitionId: source.id, version: source.version,
        name: read('name'), stream: read('stream'), namespace: read('namespace') || null, control: read('control'),
        pointer: pointer('pointer'), ...rule, ...(resourcePointer ? {resourcePointer, instance} : {})};
      const url = URL.createObjectURL(new Blob([JSON.stringify(definition, null, 2)], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'source-test.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError('');
      setSaved(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Check the test definition.');
      setSaved(false);
    }
  }
  return <details><summary>Create a custom monitoring test</summary>
    <form onSubmit={save} onChange={() => {setSaved(false); setError('');}}>
      <p>Choose a source from these search results. Use the stream and field names returned by source discovery.</p>
      <p><label>Source <select name="source">{sources.map(s => <option key={s.id} value={s.id}>{s.name} {s.version}</option>)}</select></label></p>
      <p><label>Test name <input name="name" maxLength={100} required /></label></p>
      <p><label>Workspace control UUID <input name="control" pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}" required /></label></p>
      <p><label>Stream <input name="stream" maxLength={150} required /></label>{' '}<label>Namespace (optional) <input name="namespace" maxLength={150} /></label></p>
      <p><label>Field path <input name="pointer" placeholder="/decision" maxLength={180} required /></label>{' '}
        <label>Condition <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="text">Text equals</option><option value="boolean">Boolean equals</option>
          <option value="number">Number equals</option><option value="range">Within numeric limits</option>
        </select></label></p>
      {kind === 'range' ? <p><label>Minimum <input type="number" step="any" name="minimum" required /></label>{' '}
        <label>Maximum <input type="number" step="any" name="maximum" required /></label></p> :
        <p><label>Expected value {kind === 'boolean' ? <select name="expected"><option>true</option><option>false</option></select> :
          <input key={kind} type={kind === 'number' ? 'number' : 'text'} step={kind === 'number' ? 'any' : undefined} name="expected" maxLength={200} required />}</label></p>}
      <p><label>Resource ID field (optional) <input name="identity" placeholder="/id" maxLength={180} /></label>{' '}
        <label>Source instance <input name="instance" placeholder="warehouse-east" pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,79}" /></label></p>
      <p>Choosing an ID field includes those identifiers in your private workspace receipts.</p>
      <button type="submit">Download test definition</button>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">Downloaded source-test.json. Run it with the matching source plan and the <a href="/database-bridge/setup.txt">collection instructions</a>.</p>}
    </form>
  </details>;
}
