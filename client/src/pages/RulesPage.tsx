import { useState, useEffect, useCallback } from 'react';
import type { Rule, RuleGroupWithRules } from 'shared';
import {
  fetchRules,
  createRule,
  updateRule,
  deactivateRule,
  createRuleGroup,
  deleteRuleGroup,
} from '../api';

interface RuleFormData {
  name: string;
  description: string;
  ruleGroupId: string;
  isActive: boolean;
}

const emptyForm: RuleFormData = { name: '', description: '', ruleGroupId: '', isActive: true };

export default function RulesPage() {
  const [groups, setGroups] = useState<RuleGroupWithRules[]>([]);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Which rule is being edited (null = none, 'new' = creating)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RuleFormData>(emptyForm);

  // Group creation
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchRules();
      setGroups(data);
    } catch {
      setLoadError('Failed to load rules. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const defaultGroupId = groups.find((g) => g.name === 'General')?.id || groups[0]?.id || '';

  const startCreate = () => {
    setEditingRuleId('new');
    setFormData({ ...emptyForm, ruleGroupId: defaultGroupId });
    setFormError(null);
  };

  const startEdit = (rule: Rule) => {
    setEditingRuleId(rule.id);
    setFormData({
      name: rule.name,
      description: rule.description,
      ruleGroupId: rule.ruleGroupId,
      isActive: rule.isActive,
    });
    setFormError(null);
  };

  const cancelEdit = () => {
    setEditingRuleId(null);
    setFormData(emptyForm);
    setFormError(null);
  };


  const handleSubmit = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (editingRuleId === 'new') {
        await createRule({
          name: formData.name,
          description: formData.description,
          ruleGroupId: formData.ruleGroupId || undefined,
          isActive: formData.isActive,
        });
      } else if (editingRuleId) {
        await updateRule(editingRuleId, {
          name: formData.name,
          description: formData.description,
          ruleGroupId: formData.ruleGroupId,
          isActive: formData.isActive,
        });
      }
      cancelEdit();
      await load();
    } catch (err: unknown) {
      const e = err as { message?: string; description?: string };
      setFormError(e.description || e.message || 'Failed to save rule.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (ruleId: string) => {
    try {
      await deactivateRule(ruleId);
      await load();
    } catch {
      // handled by global error display
    }
  };

  const handleCreateGroup = async () => {
    setSavingGroup(true);
    setGroupError(null);
    try {
      await createRuleGroup({ name: groupName, description: groupDescription || undefined });
      setShowGroupForm(false);
      setGroupName('');
      setGroupDescription('');
      await load();
    } catch (err: unknown) {
      const e = err as { message?: string; description?: string };
      setGroupError(e.description || e.message || 'Failed to create group.');
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId: string, groupNameLabel: string) => {
    if (!confirm(`Delete group "${groupNameLabel}"? Its rules will be moved to the General group.`)) return;
    try {
      await deleteRuleGroup(groupId);
      await load();
    } catch {
      // handled by global error display
    }
  };

  if (loading) return <p>Loading rules…</p>;

  const renderForm = () => (
    <div style={{ background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div>
          <label htmlFor="rule-name" style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: '0.85rem' }}>Name</label>
          <input
            id="rule-name"
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Rule name"
            style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <label htmlFor="rule-description" style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: '0.85rem' }}>Description</label>
          <textarea
            id="rule-description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe what this rule does"
            rows={3}
            style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box', resize: 'vertical' }}
          />
        </div>
        <div>
          <label htmlFor="rule-group" style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: '0.85rem' }}>Group</label>
          <select
            id="rule-group"
            value={formData.ruleGroupId}
            onChange={(e) => setFormData({ ...formData, ruleGroupId: e.target.value })}
            style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box' }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            id="rule-active"
            checked={formData.isActive}
            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
          />
          <label htmlFor="rule-active" style={{ fontSize: '0.85rem' }}>Active</label>
        </div>
        {formError && (
          <div role="alert" style={{ padding: '0.5rem 0.75rem', background: '#fdecea', color: '#b71c1c', borderRadius: 4, fontSize: '0.85rem' }}>
            {formError}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{ background: '#00a89d', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            {saving ? 'Saving…' : editingRuleId === 'new' ? 'Create Rule' : 'Save Changes'}
          </button>
          <button
            onClick={cancelEdit}
            style={{ background: '#fff', color: '#666', border: '1px solid #ccc', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );


  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>Business Rules</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setShowGroupForm(!showGroupForm)}
            style={{ background: '#fff', color: '#00a89d', border: '1px solid #00a89d', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            {showGroupForm ? 'Cancel' : '+ Add Group'}
          </button>
          <button
            onClick={startCreate}
            disabled={editingRuleId !== null}
            style={{ background: '#00a89d', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer', fontWeight: 600, opacity: editingRuleId !== null ? 0.5 : 1 }}
          >
            + Add Rule
          </button>
        </div>
      </div>

      {/* Group creation form */}
      {showGroupForm && (
        <div style={{ background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: 6, padding: '1rem', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>New Group</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label htmlFor="group-name" style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: '0.85rem' }}>Name</label>
              <input
                id="group-name"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
                style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label htmlFor="group-description" style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: '0.85rem' }}>Description</label>
              <input
                id="group-description"
                type="text"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="Description (optional)"
                style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box' }}
              />
            </div>
            {groupError && (
              <div role="alert" style={{ padding: '0.5rem 0.75rem', background: '#fdecea', color: '#b71c1c', borderRadius: 4, fontSize: '0.85rem' }}>
                {groupError}
              </div>
            )}
            <button
              onClick={handleCreateGroup}
              disabled={savingGroup || !groupName.trim()}
              style={{ alignSelf: 'flex-start', background: '#00a89d', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              {savingGroup ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </div>
      )}

      {/* New rule form (top-level) */}
      {editingRuleId === 'new' && renderForm()}

      {/* Rule groups */}
      {groups.map((group) => (
        <section
          key={group.id}
          style={{ background: '#fff', borderRadius: 8, padding: '1.25rem', marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{group.name}</h2>
              {group.description && (
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#666' }}>{group.description}</p>
              )}
            </div>
            {group.name !== 'General' && (
              <button
                onClick={() => handleDeleteGroup(group.id, group.name)}
                style={{ background: 'none', border: '1px solid #b71c1c', color: '#b71c1c', padding: '0.3rem 0.75rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
              >
                Delete Group
              </button>
            )}
          </div>

          {group.rules.length === 0 ? (
            <p style={{ color: '#999', fontStyle: 'italic', margin: 0 }}>No rules in this group yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {group.rules.map((rule) => (
                <div key={rule.id}>
                  {editingRuleId === rule.id ? (
                    renderForm()
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        padding: '0.75rem',
                        borderRadius: 6,
                        border: '1px solid #e0e0e0',
                        opacity: rule.isActive ? 1 : 0.5,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 600 }}>{rule.name}</span>
                          {!rule.isActive && (
                            <span style={{
                              fontSize: '0.7rem',
                              background: '#999',
                              color: '#fff',
                              padding: '1px 6px',
                              borderRadius: 10,
                            }}>
                              Inactive
                            </span>
                          )}
                        </div>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#555' }}>{rule.description}</p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem', marginLeft: '0.75rem', flexShrink: 0 }}>
                        <button
                          onClick={() => startEdit(rule)}
                          disabled={editingRuleId !== null}
                          style={{ background: 'none', border: '1px solid #00a89d', color: '#00a89d', padding: '0.25rem 0.6rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
                        >
                          Edit
                        </button>
                        {rule.isActive && (
                          <button
                            onClick={() => handleDeactivate(rule.id)}
                            style={{ background: 'none', border: '1px solid #e65100', color: '#e65100', padding: '0.25rem 0.6rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      {groups.length === 0 && !loadError && (
        <p style={{ color: '#999', textAlign: 'center', marginTop: '2rem' }}>
          No rule groups found. Create a group to get started.
        </p>
      )}

      {loadError && (
        <div
          role="alert"
          style={{
            background: '#fff3e0',
            border: '1px solid #ffb74d',
            borderRadius: 8,
            padding: '1.25rem',
            marginTop: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <span style={{ color: '#e65100', fontWeight: 500 }}>{loadError}</span>
          <button
            onClick={load}
            style={{
              background: '#e65100',
              color: '#fff',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
