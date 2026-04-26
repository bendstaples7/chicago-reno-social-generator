import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Rule, RuleGroupWithRules, ProductCatalogEntry } from 'shared';
import {
  fetchRules,
  createRule,
  updateRule,
  deactivateRule,
  createRuleGroup,
  deleteRuleGroup,
  summarizeRuleTitle,
  regenerateRuleTitles,
  autoCategorizeRules,
  fetchCatalog,
  reorderCatalog,
} from '../api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'rules' | 'ordering';

interface RuleFormData {
  name: string;
  description: string;
  ruleGroupId: string;
  isActive: boolean;
}

const emptyForm: RuleFormData = { name: '', description: '', ruleGroupId: '', isActive: true };

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const TAB_STYLE_BASE: React.CSSProperties = {
  padding: '0.6rem 1.25rem',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.95rem',
  color: '#666',
};

const TAB_STYLE_ACTIVE: React.CSSProperties = {
  ...TAB_STYLE_BASE,
  color: '#00a89d',
  borderBottomColor: '#00a89d',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RulesPage() {
  const [activeTab, setActiveTab] = useState<TabId>('rules');
  const [orderingDirty, setOrderingDirty] = useState(false);

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Tab bar */}
      <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', marginBottom: '1.25rem' }}>
        <button
          style={activeTab === 'rules' ? TAB_STYLE_ACTIVE : TAB_STYLE_BASE}
          onClick={() => {
            if (activeTab === 'rules') return;
            if (activeTab === 'ordering' && orderingDirty) {
              if (!confirm('You have unsaved ordering changes. Discard them?')) return;
            }
            setActiveTab('rules');
            setOrderingDirty(false);
          }}
          aria-selected={activeTab === 'rules'}
          aria-controls="business-rules-panel"
          role="tab"
        >
          Business Rules
        </button>
        <button
          style={activeTab === 'ordering' ? TAB_STYLE_ACTIVE : TAB_STYLE_BASE}
          onClick={() => {
            if (activeTab === 'ordering') return;
            setActiveTab('ordering');
          }}
          aria-selected={activeTab === 'ordering'}
          aria-controls="product-ordering-panel"
          role="tab"
        >
          Product Ordering
        </button>
      </div>

      {activeTab === 'rules' && <div role="tabpanel" id="business-rules-panel"><BusinessRulesTab /></div>}
      {activeTab === 'ordering' && <div role="tabpanel" id="product-ordering-panel"><ProductOrderingTab onDirtyChange={setOrderingDirty} /></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Business Rules Tab (existing functionality, extracted)
// ---------------------------------------------------------------------------

function BusinessRulesTab() {
  const [groups, setGroups] = useState<RuleGroupWithRules[]>([]);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RuleFormData>(emptyForm);
  const [summarizingTitle, setSummarizingTitle] = useState(false);

  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);

  const [regenerating, setRegenerating] = useState(false);
  const [regenerateResult, setRegenerateResult] = useState<string | null>(null);
  const [categorizing, setCategorizing] = useState(false);
  const [categorizeResult, setCategorizeResult] = useState<string | null>(null);

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

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        rules: group.rules.filter(
          (rule) =>
            rule.name.toLowerCase().includes(q) ||
            rule.description.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.rules.length > 0 || group.name.toLowerCase().includes(q));
  }, [groups, searchQuery]);

  const totalRuleCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.rules.length, 0),
    [groups],
  );

  const filteredRuleCount = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.rules.length, 0),
    [filteredGroups],
  );

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

  const handleSummarizeTitle = async () => {
    if (!formData.description.trim()) return;
    setSummarizingTitle(true);
    try {
      const title = await summarizeRuleTitle(formData.description);
      setFormData((prev) => ({ ...prev, name: title }));
    } catch {
      // Silently fail
    } finally {
      setSummarizingTitle(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    setFormError(null);
    try {
      let nameToUse = formData.name;
      if (!nameToUse.trim() && formData.description.trim()) {
        try {
          nameToUse = await summarizeRuleTitle(formData.description);
        } catch {
          nameToUse = formData.description.slice(0, 60);
        }
      }

      if (editingRuleId === 'new') {
        await createRule({
          name: nameToUse,
          description: formData.description,
          ruleGroupId: formData.ruleGroupId || undefined,
          isActive: formData.isActive,
        });
      } else if (editingRuleId) {
        await updateRule(editingRuleId, {
          name: nameToUse,
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

  const handleRegenerateTitles = async () => {
    setRegenerating(true);
    setRegenerateResult(null);
    try {
      const result = await regenerateRuleTitles();
      setRegenerateResult(`Updated ${result.updated} of ${result.total} rule titles.`);
      await load();
    } catch {
      setRegenerateResult('Failed to regenerate titles. Please try again.');
    } finally {
      setRegenerating(false);
    }
  };

  const handleAutoCategorize = async () => {
    setCategorizing(true);
    setCategorizeResult(null);
    try {
      const result = await autoCategorizeRules();
      setCategorizeResult(
        result.moved > 0
          ? `Moved ${result.moved} of ${result.total} rules into trade groups.`
          : `All ${result.total} rules are already categorized.`,
      );
      await load();
    } catch {
      setCategorizeResult('Failed to auto-categorize. Please try again.');
    } finally {
      setCategorizing(false);
    }
  };

  if (loading) return <p>Loading rules…</p>;

  const renderForm = () => (
    <div style={{ background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
          <label htmlFor="rule-name" style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: '0.85rem' }}>
            Title
            <span style={{ fontWeight: 400, color: '#888', marginLeft: 6, fontSize: '0.8rem' }}>
              (auto-generated if left blank)
            </span>
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              id="rule-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Leave blank to auto-generate from description"
              style={{ flex: 1, padding: '0.5rem', borderRadius: 4, border: '1px solid #ccc', boxSizing: 'border-box' }}
            />
            <button
              type="button"
              onClick={handleSummarizeTitle}
              disabled={summarizingTitle || !formData.description.trim()}
              title="Generate a concise title from the description"
              style={{
                background: '#fff',
                color: '#00a89d',
                border: '1px solid #00a89d',
                padding: '0.5rem 0.75rem',
                borderRadius: 4,
                cursor: summarizingTitle || !formData.description.trim() ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
                opacity: summarizingTitle || !formData.description.trim() ? 0.5 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {summarizingTitle ? 'Generating…' : '✨ Summarize'}
            </button>
          </div>
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
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
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

      {/* Search bar */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search rules by title or description…"
            aria-label="Search rules"
            style={{
              width: '100%',
              padding: '0.6rem 0.75rem 0.6rem 2.25rem',
              borderRadius: 6,
              border: '1px solid #ccc',
              boxSizing: 'border-box',
              fontSize: '0.9rem',
            }}
          />
          <span
            style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#999',
              fontSize: '0.9rem',
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          >
            🔍
          </span>
        </div>
        {searchQuery.trim() && (
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#666' }}>
            Showing {filteredRuleCount} of {totalRuleCount} rules
          </p>
        )}
      </div>

      {/* Rule management actions */}
      {totalRuleCount > 0 && (
        <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={handleRegenerateTitles}
            disabled={regenerating}
            style={{
              background: '#fff',
              color: '#555',
              border: '1px solid #ccc',
              padding: '0.4rem 0.75rem',
              borderRadius: 6,
              cursor: regenerating ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              opacity: regenerating ? 0.6 : 1,
            }}
          >
            {regenerating ? 'Regenerating…' : '✨ Regenerate Rule Titles'}
          </button>
          <button
            onClick={handleAutoCategorize}
            disabled={categorizing}
            style={{
              background: '#fff',
              color: '#555',
              border: '1px solid #ccc',
              padding: '0.4rem 0.75rem',
              borderRadius: 6,
              cursor: categorizing ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              opacity: categorizing ? 0.6 : 1,
            }}
          >
            {categorizing ? 'Categorizing…' : '🏷️ Auto-Categorize by Trade'}
          </button>
          {regenerateResult && (
            <span style={{ fontSize: '0.8rem', color: '#666' }}>{regenerateResult}</span>
          )}
          {categorizeResult && (
            <span style={{ fontSize: '0.8rem', color: '#666' }}>{categorizeResult}</span>
          )}
        </div>
      )}

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
      {filteredGroups.map((group) => (
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
                          {rule.conditionJson && rule.actionJson && (
                            <span style={{
                              fontSize: '0.7rem',
                              background: '#e3f2fd',
                              color: '#1565c0',
                              padding: '1px 6px',
                              borderRadius: 10,
                            }}
                            title="This rule has structured conditions and actions that are enforced deterministically"
                            >
                              Structured
                            </span>
                          )}
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

      {filteredGroups.length === 0 && searchQuery.trim() && (
        <p style={{ color: '#999', textAlign: 'center', marginTop: '2rem' }}>
          No rules match "{searchQuery}".
        </p>
      )}

      {groups.length === 0 && !loadError && !searchQuery.trim() && (
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
    </>
  );
}


// ---------------------------------------------------------------------------
// Product Ordering Tab
// ---------------------------------------------------------------------------

function ProductOrderingTab({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [catalog, setCatalog] = useState<ProductCatalogEntry[]>([]);
  const [snapshotCatalog, setSnapshotCatalog] = useState<ProductCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => { onDirtyChange?.(false); };
  }, [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCatalog();
      setCatalog(data);
      setSnapshotCatalog(data);
      setDirty(false);
    } catch {
      setLoadError('Failed to load product catalog. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= catalog.length) return;
    const updated = [...catalog];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setCatalog(updated);
    setDirty(true);
    setSaveMessage(null);
    setSaveStatus(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const orderedIds = catalog.map((c) => c.id);
      const updated = await reorderCatalog(orderedIds);
      setCatalog(updated);
      setSnapshotCatalog(updated);
      setDirty(false);
      setSaveStatus('success');
      setSaveMessage('Product ordering saved.');
    } catch {
      setSaveStatus('error');
      setSaveMessage('Failed to save ordering. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setCatalog(snapshotCatalog);
    setDirty(false);
    setSaveMessage(null);
    setSaveStatus(null);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || index === dragIndex) return;
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const updated = [...catalog];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(index, 0, moved);
    setCatalog(updated);
    setDirty(true);
    setSaveMessage(null);
    setSaveStatus(null);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  if (loading) return <p>Loading product catalog…</p>;

  if (loadError) {
    return (
      <div
        role="alert"
        style={{
          background: '#fff3e0',
          border: '1px solid #ffb74d',
          borderRadius: 8,
          padding: '1.25rem',
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
    );
  }

  if (catalog.length === 0) {
    return (
      <div style={{ textAlign: 'center', marginTop: '2rem', color: '#999' }}>
        <p>No products in the catalog yet.</p>
        <p style={{ fontSize: '0.85rem' }}>Add products via the Catalog & Templates page first.</p>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.25rem' }}>Product Ordering</h1>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
            Set the default order products appear in new quotes. Items at the top of this list appear first on generated quotes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
          {dirty && (
            <button
              onClick={handleReset}
              disabled={saving}
              style={{
                background: '#fff',
                color: '#666',
                border: '1px solid #ccc',
                padding: '0.5rem 1rem',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{
              background: dirty ? '#00a89d' : '#ccc',
              color: '#fff',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: 6,
              cursor: dirty && !saving ? 'pointer' : 'not-allowed',
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : 'Save Order'}
          </button>
        </div>
      </div>

      {saveMessage && (
        <div
          style={{
            padding: '0.5rem 0.75rem',
            background: saveStatus === 'error' ? '#fdecea' : '#e8f5e9',
            color: saveStatus === 'error' ? '#b71c1c' : '#2e7d32',
            borderRadius: 4,
            fontSize: '0.85rem',
            marginBottom: '1rem',
          }}
        >
          {saveMessage}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {catalog.map((entry, index) => (
          <div
            key={entry.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.65rem 0.75rem',
              background: '#fff',
              border: '1px solid #e0e0e0',
              borderRadius: 6,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              opacity: dragIndex === index ? 0.4 : 1,
              borderTop: dragOverIndex === index ? '2px solid #00a89d' : '1px solid #e0e0e0',
              transition: 'opacity 0.15s ease',
            }}
          >
            {/* Drag handle */}
            <span
              aria-label={`Drag to reorder ${entry.name}`}
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'grab',
                fontSize: '1rem',
                color: '#999',
                flexShrink: 0,
                userSelect: 'none',
                touchAction: 'none',
              }}
            >
              ☰
            </span>

            {/* Position number */}
            <span
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f0f0f0',
                borderRadius: '50%',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#666',
                flexShrink: 0,
              }}
            >
              {index + 1}
            </span>

            {/* Product info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{entry.name}</div>
              {entry.description && (
                <div style={{ fontSize: '0.8rem', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {entry.description}
                </div>
              )}
            </div>

            {/* Price */}
            <span style={{ fontSize: '0.85rem', color: '#555', flexShrink: 0 }}>
              ${entry.unitPrice.toFixed(2)}
            </span>

            {/* Move buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
              <button
                onClick={() => moveItem(index, 'up')}
                disabled={index === 0}
                aria-label={`Move ${entry.name} up`}
                style={{
                  background: 'none',
                  border: '1px solid #ccc',
                  borderRadius: 3,
                  padding: '1px 6px',
                  cursor: index === 0 ? 'not-allowed' : 'pointer',
                  opacity: index === 0 ? 0.3 : 1,
                  fontSize: '0.75rem',
                  lineHeight: 1,
                }}
              >
                ▲
              </button>
              <button
                onClick={() => moveItem(index, 'down')}
                disabled={index === catalog.length - 1}
                aria-label={`Move ${entry.name} down`}
                style={{
                  background: 'none',
                  border: '1px solid #ccc',
                  borderRadius: 3,
                  padding: '1px 6px',
                  cursor: index === catalog.length - 1 ? 'not-allowed' : 'pointer',
                  opacity: index === catalog.length - 1 ? 0.3 : 1,
                  fontSize: '0.75rem',
                  lineHeight: 1,
                }}
              >
                ▼
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
