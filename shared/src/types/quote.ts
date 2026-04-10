/** A product from the Jobber catalog or manual entry */
export interface ProductCatalogEntry {
  id: string;
  name: string;
  unitPrice: number;
  description: string;
  category?: string;
  source: 'jobber' | 'manual';
}

/** A quote template from Jobber or manual entry */
export interface QuoteTemplate {
  id: string;
  name: string;
  content: string;
  category?: string;
  source: 'jobber' | 'manual';
}

/** A matched line item in a quote draft */
export interface QuoteLineItem {
  id: string;
  productCatalogEntryId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  confidenceScore: number;
  originalText: string;
  resolved: boolean;
  unmatchedReason?: string;
}

/** The full quote draft */
export interface QuoteDraft {
  id: string;
  draftNumber: number;
  userId: string;
  customerRequestText: string;
  selectedTemplateId: string | null;
  selectedTemplateName: string | null;
  lineItems: QuoteLineItem[];
  unresolvedItems: QuoteLineItem[];
  catalogSource: 'jobber' | 'manual';
  jobberRequestId: string | null;
  status: 'draft' | 'finalized';
  similarQuotes?: SimilarQuote[];
  revisionHistory?: RevisionHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

/** Form answer from a Jobber request submission */
export interface JobberFormAnswer {
  label: string;
  value: string | null;
}

/** Form section from a Jobber request submission */
export interface JobberFormSection {
  label: string;
  sortOrder: number;
  answers: JobberFormAnswer[];
}

/** Form data from a Jobber request submission */
export interface JobberRequestFormData {
  sections: JobberFormSection[];
  text: string;
}

/** A note on a Jobber customer request */
export interface JobberRequestNote {
  message: string;
  createdBy: 'team' | 'client' | 'system';
  createdAt: string;
}

/** A customer request from Jobber */
export interface JobberCustomerRequest {
  id: string;
  title: string;
  clientName: string;
  description: string;
  notes: string[];
  structuredNotes: JobberRequestNote[];
  imageUrls: string[];
  jobberWebUri: string;
  formData?: JobberRequestFormData;
  createdAt: string;
}

/** A similar past quote found via embedding similarity search */
export interface SimilarQuote {
  jobberQuoteId: string;
  quoteNumber: string;
  title: string;
  message: string;
  similarityScore: number;
}

/** A single entry in the revision history for a quote draft */
export interface RevisionHistoryEntry {
  id: string;
  quoteDraftId: string;
  feedbackText: string;
  createdAt: Date;
}

/** Update payload for editing a draft */
export interface QuoteDraftUpdate {
  lineItems?: Partial<QuoteLineItem>[];
  unresolvedItems?: Partial<QuoteLineItem>[];
  selectedTemplateId?: string | null;
  status?: 'draft' | 'finalized';
}
