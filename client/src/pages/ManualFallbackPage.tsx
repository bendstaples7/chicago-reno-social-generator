import { useState, useEffect, useCallback } from 'react';
import type { ProductCatalogEntry, QuoteTemplate, ErrorResponse } from 'shared';
import {
  fetchCatalog,
  saveCatalog,
  fetchTemplates,
  saveTemplates,
  checkJobberStatus,
} from '../api';

interface CatalogFormEntry {
  name: string;
  unitPrice: string;
  description: string;
}

const emptyCatalogEntry: CatalogFormEntry = { name: '', unitPrice: '', description: '' };

interface TemplateFormEntry {
  name: string;
  content: string;
}

const emptyTemplateEntry: TemplateFormEntry = { name: '', content: '' };

export default function ManualFallbackPage() {
  // Catalog state
  const [catalogEntries, setCatalogEntries] = useState<ProductCatalogEntry[]>([]);
  const [newProduct, setNewProduct] = useState<CatalogFormEntry>({ ...emptyCatalogEntry });
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<CatalogFormEntry>({ ...emptyCatalogEntry });

  // Template state
  const [templateEntries, setTemplateEntries] = useState<QuoteTemplate[]>([]);
  const [newTemplate, setNewTemplate] = useState<TemplateFormEntry>({ ...emptyTemplateEntry });

  // General state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [jobberAvailable, setJobberAvailable] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [catalogRes, templatesRes, statusRes] = await Promise.all([
        fetchCatalog(),
        fetchTemplates(),
        checkJobberStatus(),
      ]);
      setCatalogEntries(catalogRes);
      setTemplateEntries(templatesRes);
      setJobberAvailable(statusRes);
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Poll Jobber status every 30s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const available = await checkJobberStatus();
        setJobberAvailable(available);
      } catch { /* ignore */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const clearMessages = () => { setError(null); setSuccessMsg(null); };

  // ── Catalog CRUD ──

  const handleAddProduct = async () => {
    clearMessages();
    if (!newProduct.name.trim() || !newProduct.unitPrice.trim()) {
      setError('Product name and unit price are required.');
      return;
    }
    const price = parseFloat(newProduct.unitPrice);
    if (isNaN(price) || price < 0) {
      setError('Unit price must be a valid non-negative number.');
      return;
    }

    const updated = [
      ...catalogEntries,
      {
        id: 'temp-' + Date.now(),
        name: newProduct.name.trim(),
        unitPrice: price,
        description: newProduct.description.trim(),
        source: 'manual' as const,
      },
    ];

    await persistCatalog(updated);
    setNewProduct({ ...emptyCatalogEntry });
  };

  const handleEditProduct = (entry: ProductCatalogEntry) => {
    setEditingProductId(entry.id);
    setEditProduct({
      name: entry.name,
      unitPrice: String(entry.unitPrice),
      description: entry.description,
    });
  };

  const handleSaveEdit = async () => {
    clearMessages();
    if (!editProduct.name.trim() || !editProduct.unitPrice.trim()) {
      setError('Product name and unit price are required.');
      return;
    }
    const price = parseFloat(editProduct.unitPrice);
    if (isNaN(price) || price < 0) {
      setError('Unit price must be a valid non-negative number.');
      return;
    }

    const updated = catalogEntries.map((e) =>
      e.id === editingProductId
        ? { ...e, name: editProduct.name.trim(), unitPrice: price, description: editProduct.description.trim() }
        : e,
    );

    await persistCatalog(updated);
    setEditingProductId(null);
  };

  const handleRemoveProduct = async (id: string) => {
    clearMessages();
    const updated = catalogEntries.filter((e) => e.id !== id);
    await persistCatalog(updated);
  };

  const persistCatalog = async (entries: ProductCatalogEntry[]) => {
    try {
      setSaving(true);
      const saved = await saveCatalog(
        entries.map((e) => ({ name: e.name, unitPrice: e.unitPrice, description: e.description, category: e.category })),
      );
      setCatalogEntries(saved);
      setSuccessMsg('Catalog saved.');
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to save catalog.');
    } finally {
      setSaving(false);
    }
  };

  // ── Template CRUD ──

  const handleAddTemplate = async () => {
    clearMessages();
    if (!newTemplate.name.trim() || !newTemplate.content.trim()) {
      setError('Template name and content are required.');
      return;
    }

    const updated = [
      ...templateEntries,
      {
        id: 'temp-' + Date.now(),
        name: newTemplate.name.trim(),
        content: newTemplate.content.trim(),
        source: 'manual' as const,
      },
    ];

    await persistTemplates(updated);
    setNewTemplate({ ...emptyTemplateEntry });
  };

  const handleRemoveTemplate = async (id: string) => {
    clearMessages();
    const updated = templateEntries.filter((t) => t.id !== id);
    await persistTemplates(updated);
  };

  const persistTemplates = async (entries: QuoteTemplate[]) => {
    try {
      setSaving(true);
      const saved = await saveTemplates(
        entries.map((t) => ({ name: t.name, content: t.content, category: t.category })),
      );
      setTemplateEntries(saved);
      setSuccessMsg('Templates saved.');
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to save templates.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={loadingContainerStyle}>
          <span style={spinnerStyle} />
          <p style={{ margin: '0.75rem 0 0', color: '#555' }}>Loading catalog data…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>Manual Catalog &amp; Templates</h1>

      {/* Jobber availability banner */}
      {jobberAvailable && (
        <div style={jobberBannerStyle} role="status">
          ✅ Jobber API is available. Product catalog and templates will be sourced from Jobber when generating quotes.
        </div>
      )}

      {error && <div role="alert" style={alertStyle}>{error}</div>}
      {successMsg && <div role="status" style={successStyle}>{successMsg}</div>}

      {/* ── Product Catalog Section ── */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Product Catalog</h2>

        {/* Add product form */}
        <div style={formRowStyle}>
          <input
            type="text"
            placeholder="Product name"
            value={newProduct.name}
            onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
            style={{ ...inputStyle, flex: 2 }}
            disabled={saving}
            aria-label="New product name"
          />
          <input
            type="number"
            placeholder="Unit price"
            value={newProduct.unitPrice}
            onChange={(e) => setNewProduct((p) => ({ ...p, unitPrice: e.target.value }))}
            style={{ ...inputStyle, flex: 1 }}
            min="0"
            step="0.01"
            disabled={saving}
            aria-label="New product unit price"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newProduct.description}
            onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
            style={{ ...inputStyle, flex: 2 }}
            disabled={saving}
            aria-label="New product description"
          />
          <button onClick={handleAddProduct} disabled={saving} style={addBtnStyle} type="button">
            Add
          </button>
        </div>

        {/* Product list */}
        {catalogEntries.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>No products in the manual catalog.</p>
        ) : (
          <div style={{ marginTop: '0.75rem' }}>
            {catalogEntries.map((entry) => (
              <div key={entry.id} style={itemRowStyle}>
                {editingProductId === entry.id ? (
                  <>
                    <input
                      type="text"
                      value={editProduct.name}
                      onChange={(e) => setEditProduct((p) => ({ ...p, name: e.target.value }))}
                      style={{ ...inputStyle, flex: 2 }}
                      aria-label="Edit product name"
                    />
                    <input
                      type="number"
                      value={editProduct.unitPrice}
                      onChange={(e) => setEditProduct((p) => ({ ...p, unitPrice: e.target.value }))}
                      style={{ ...inputStyle, flex: 1 }}
                      min="0"
                      step="0.01"
                      aria-label="Edit product unit price"
                    />
                    <input
                      type="text"
                      value={editProduct.description}
                      onChange={(e) => setEditProduct((p) => ({ ...p, description: e.target.value }))}
                      style={{ ...inputStyle, flex: 2 }}
                      aria-label="Edit product description"
                    />
                    <button onClick={handleSaveEdit} style={saveBtnStyle} type="button">Save</button>
                    <button onClick={() => setEditingProductId(null)} style={cancelBtnStyle} type="button">Cancel</button>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 500 }}>{entry.name}</span>
                      <span style={{ color: '#888', marginLeft: '0.5rem' }}>${entry.unitPrice.toFixed(2)}</span>
                      {entry.description && (
                        <span style={{ color: '#aaa', marginLeft: '0.5rem', fontSize: '0.85rem' }}>— {entry.description}</span>
                      )}
                    </div>
                    <button onClick={() => handleEditProduct(entry)} style={editBtnStyle} type="button" aria-label={`Edit ${entry.name}`}>✏️</button>
                    <button onClick={() => handleRemoveProduct(entry.id)} style={removeBtnStyle} type="button" aria-label={`Remove ${entry.name}`}>🗑</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Template Library Section ── */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Quote Templates</h2>

        {/* Add template form */}
        <div style={{ marginBottom: '0.75rem' }}>
          <input
            type="text"
            placeholder="Template name"
            value={newTemplate.name}
            onChange={(e) => setNewTemplate((t) => ({ ...t, name: e.target.value }))}
            style={{ ...inputStyle, width: '100%', marginBottom: '0.5rem', boxSizing: 'border-box' }}
            disabled={saving}
            aria-label="New template name"
          />
          <textarea
            placeholder="Paste or type template content…"
            value={newTemplate.content}
            onChange={(e) => setNewTemplate((t) => ({ ...t, content: e.target.value }))}
            rows={4}
            style={textareaStyle}
            disabled={saving}
            aria-label="New template content"
          />
          <button onClick={handleAddTemplate} disabled={saving} style={{ ...addBtnStyle, marginTop: '0.5rem' }} type="button">
            Add Template
          </button>
        </div>

        {/* Template list */}
        {templateEntries.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>No templates in the manual library.</p>
        ) : (
          <div>
            {templateEntries.map((tmpl) => (
              <div key={tmpl.id} style={itemRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>{tmpl.name}</div>
                  <pre style={templatePreviewStyle}>
                    {tmpl.content.length > 200 ? tmpl.content.slice(0, 200) + '…' : tmpl.content}
                  </pre>
                </div>
                <button onClick={() => handleRemoveTemplate(tmpl.id)} style={removeBtnStyle} type="button" aria-label={`Remove template ${tmpl.name}`}>🗑</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}


// ── Styles ──

const containerStyle: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const titleStyle: React.CSSProperties = { margin: '0 0 1.25rem', fontSize: '1.5rem' };

const loadingContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '3rem 0',
};

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 28,
  height: 28,
  border: '3px solid #e0e0e0',
  borderTopColor: '#1976d2',
  borderRadius: '50%',
  animation: 'spin 0.6s linear infinite',
};

const alertStyle: React.CSSProperties = {
  background: '#fdecea',
  color: '#611a15',
  padding: '0.75rem 1rem',
  borderRadius: 4,
  marginBottom: '1rem',
};

const successStyle: React.CSSProperties = {
  background: '#e8f5e9',
  color: '#2e7d32',
  padding: '0.75rem 1rem',
  borderRadius: 4,
  marginBottom: '1rem',
};

const jobberBannerStyle: React.CSSProperties = {
  background: '#e8f5e9',
  color: '#2e7d32',
  padding: '0.75rem 1rem',
  borderRadius: 6,
  marginBottom: '1.25rem',
  fontSize: '0.9rem',
};

const sectionStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  marginBottom: '1.25rem',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '1.1rem',
  fontWeight: 600,
};

const formRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: '0.85rem',
};

const textareaStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.5rem',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: '0.85rem',
  boxSizing: 'border-box' as const,
  resize: 'vertical',
  fontFamily: 'inherit',
};

const addBtnStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  border: '1px solid #1976d2',
  background: '#1976d2',
  color: '#fff',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.85rem',
  whiteSpace: 'nowrap',
};

const itemRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.5rem 0',
  borderBottom: '1px solid #f0f0f0',
};

const editBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.9rem',
  padding: '0.25rem',
};

const removeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.9rem',
  padding: '0.25rem',
  color: '#888',
};

const saveBtnStyle: React.CSSProperties = {
  padding: '0.3rem 0.6rem',
  border: '1px solid #2e7d32',
  background: '#2e7d32',
  color: '#fff',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.8rem',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '0.3rem 0.6rem',
  border: '1px solid #888',
  background: 'transparent',
  color: '#888',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.8rem',
};

const templatePreviewStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#666',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: '#fafafa',
  padding: '0.4rem',
  borderRadius: 4,
  maxHeight: 80,
  overflow: 'hidden',
};
