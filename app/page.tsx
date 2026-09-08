'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Clock,
  FileText,
  LoaderCircle,
  MessageSquare,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

type DocumentItem = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  status: string;
  uploadedAt: number;
  selected: boolean;
};

type Message = {
  role: 'user' | 'assistant';
  text: string;
  sources?: string[];
  mode?: 'local' | 'gemini';
};

type HistoryItem = {
  id: string;
  question: string;
  answer: string;
  sourceDocumentIds: string[];
  createdAt: number;
};

type View = 'chat' | 'documents' | 'history';

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

async function extractText(file: File) {
  if (file.type !== 'application/pdf') return file.text();

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
    );
  }

  return pages.join('\n\n');
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export default function Home() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Add a document and ask a question about it.',
    },
  ]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [view, setView] = useState<View>('chat');
  const [question, setQuestion] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [notice, setNotice] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedDocuments = documents.filter((document) => document.selected);
  const visibleDocuments = useMemo(
    () =>
      documents.filter((document) =>
        document.filename.toLowerCase().includes(search.toLowerCase()),
      ),
    [documents, search],
  );

  useEffect(() => {
    void loadWorkspace();
  }, []);

  async function loadWorkspace() {
    setLoading(true);
    try {
      const [documentData, historyData] = await Promise.all([
        api<{ documents: Omit<DocumentItem, 'selected'>[] }>('/api/documents'),
        api<{ history: HistoryItem[] }>('/api/chat/history'),
      ]);
      setDocuments(
        documentData.documents.map((document) => ({
          ...document,
          selected: true,
        })),
      );
      setHistory(historyData.history);
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not load the app.',
      });
    } finally {
      setLoading(false);
    }
  }

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) =>
      /\.(pdf|txt|md)$/i.test(file.name),
    );

    if (!files.length) {
      setNotice({ type: 'error', text: 'Use a PDF, TXT, or Markdown file.' });
      return;
    }

    setUploading(true);
    setNotice(null);
    let uploadedCount = 0;

    for (const file of files) {
      try {
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`${file.name} is larger than 10 MB.`);
        }

        const text = await extractText(file);
        const formData = new FormData();
        formData.set('file', file);
        formData.set('text', text);

        const result = await api<{
          document: Omit<DocumentItem, 'selected'>;
        }>('/api/documents', { method: 'POST', body: formData });

        setDocuments((current) => [
          { ...result.document, selected: true },
          ...current,
        ]);
        uploadedCount += 1;
      } catch (error) {
        setNotice({
          type: 'error',
          text:
            error instanceof Error
              ? error.message
              : `Could not upload ${file.name}.`,
        });
      }
    }

    if (uploadedCount) {
      setNotice({
        type: 'success',
        text: `${uploadedCount} file${uploadedCount === 1 ? '' : 's'} uploaded.`,
      });
    }

    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function removeDocument(document: DocumentItem) {
    if (!window.confirm(`Delete ${document.filename}?`)) return;

    const previousDocuments = documents;
    setDocuments((current) => current.filter((item) => item.id !== document.id));

    try {
      await api(`/api/documents/${encodeURIComponent(document.id)}`, {
        method: 'DELETE',
      });
      setNotice({ type: 'success', text: 'Document deleted.' });
    } catch (error) {
      setDocuments(previousDocuments);
      setNotice({
        type: 'error',
        text:
          error instanceof Error ? error.message : 'Could not delete the document.',
      });
    }
  }

  async function askQuestion(event: React.FormEvent) {
    event.preventDefault();
    const value = question.trim();
    if (!value || answering) return;

    if (!selectedDocuments.length) {
      setNotice({ type: 'error', text: 'Select at least one document first.' });
      return;
    }

    setMessages((current) => [...current, { role: 'user', text: value }]);
    setQuestion('');
    setAnswering(true);
    setNotice(null);

    try {
      const result = await api<{
        answer: string;
        sources: string[];
        mode: 'local' | 'gemini';
      }>('/api/chat/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: value,
          documentIds: selectedDocuments.map((document) => document.id),
        }),
      });

      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: result.answer,
          sources: result.sources,
          mode: result.mode,
        },
      ]);

      const historyData = await api<{ history: HistoryItem[] }>(
        '/api/chat/history',
      );
      setHistory(historyData.history);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text:
            error instanceof Error
              ? error.message
              : 'Could not answer the question.',
        },
      ]);
    } finally {
      setAnswering(false);
    }
  }

  async function clearHistory() {
    if (!window.confirm('Delete all chat history?')) return;

    try {
      await api('/api/chat/history', { method: 'DELETE' });
      setHistory([]);
      setNotice({ type: 'success', text: 'History cleared.' });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not clear history.',
      });
    }
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <button className="logo" onClick={() => setView('chat')}>
          ask<span>AI</span>
        </button>

        <nav aria-label="Main navigation">
          <button
            className={view === 'chat' ? 'active' : ''}
            onClick={() => setView('chat')}
          >
            <MessageSquare /> Chat
          </button>
          <button
            className={view === 'documents' ? 'active' : ''}
            onClick={() => setView('documents')}
          >
            <FileText /> Documents
          </button>
          <button
            className={view === 'history' ? 'active' : ''}
            onClick={() => setView('history')}
          >
            <Clock /> History
          </button>
        </nav>

        <button
          className="primary-button header-upload"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? <LoaderCircle className="spin" /> : <Upload />}
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </header>

      {notice && (
        <div className={`notice ${notice.type}`} role="status">
          {notice.type === 'error' ? <AlertCircle /> : <Check />}
          <span>{notice.text}</span>
          {/sign in/i.test(notice.text) && (
            <a href="/signin-with-chatgpt?return_to=%2F" target="_top">
              Sign in
            </a>
          )}
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X />
          </button>
        </div>
      )}

      <input
        ref={fileInput}
        className="screen-reader-only"
        type="file"
        accept=".pdf,.txt,.md"
        multiple
        onChange={(event) =>
          event.target.files && void addFiles(event.target.files)
        }
      />

      <main className="page-content">
        {view === 'chat' && (
          <div className="chat-layout">
            <DocumentsPanel
              compact
              documents={visibleDocuments}
              totalCount={documents.length}
              search={search}
              loading={loading}
              uploading={uploading}
              onSearch={setSearch}
              onUpload={() => fileInput.current?.click()}
              onToggle={(id) =>
                setDocuments((current) =>
                  current.map((document) =>
                    document.id === id
                      ? { ...document, selected: !document.selected }
                      : document,
                  ),
                )
              }
              onDelete={(document) => void removeDocument(document)}
            />

            <section className="panel chat-panel" aria-label="Document chat">
              <div className="panel-heading">
                <div>
                  <h1>Chat</h1>
                  <p>{selectedDocuments.length} document(s) selected</p>
                </div>
                <button className="text-button" onClick={() => setView('documents')}>
                  Manage documents
                </button>
              </div>

              <div className="message-list">
                {messages.map((message, index) => (
                  <article className={`message ${message.role}`} key={index}>
                    <strong>{message.role === 'user' ? 'You' : 'askAI'}</strong>
                    <div>
                      <p>{message.text}</p>
                      {!!message.sources?.length && (
                        <div className="source-list">
                          {message.sources.map((source) => (
                            <span key={source}>{source}</span>
                          ))}
                          <span>
                            {message.mode === 'gemini' ? 'Gemini' : 'Local search'}
                          </span>
                        </div>
                      )}
                    </div>
                  </article>
                ))}

                {answering && (
                  <div className="working-message">
                    <LoaderCircle className="spin" /> Searching documents...
                  </div>
                )}
              </div>

              <form className="question-form" onSubmit={askQuestion}>
                <label htmlFor="question">Ask a question</label>
                <textarea
                  id="question"
                  maxLength={1200}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Example: What are the main points in these documents?"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div>
                  <small>{question.length}/1200</small>
                  <button
                    className="primary-button"
                    disabled={!question.trim() || answering}
                  >
                    <Send /> Send
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {view === 'documents' && (
          <DocumentsPanel
            documents={visibleDocuments}
            totalCount={documents.length}
            search={search}
            loading={loading}
            uploading={uploading}
            onSearch={setSearch}
            onUpload={() => fileInput.current?.click()}
            onToggle={(id) =>
              setDocuments((current) =>
                current.map((document) =>
                  document.id === id
                    ? { ...document, selected: !document.selected }
                    : document,
                ),
              )
            }
            onDelete={(document) => void removeDocument(document)}
          />
        )}

        {view === 'history' && (
          <HistoryPanel
            history={history}
            documents={documents}
            onClear={() => void clearHistory()}
            onAskAgain={(value) => {
              setQuestion(value);
              setView('chat');
            }}
          />
        )}
      </main>
    </div>
  );
}

function DocumentsPanel({
  compact = false,
  documents,
  totalCount,
  search,
  loading,
  uploading,
  onSearch,
  onUpload,
  onToggle,
  onDelete,
}: {
  compact?: boolean;
  documents: DocumentItem[];
  totalCount: number;
  search: string;
  loading: boolean;
  uploading: boolean;
  onSearch: (value: string) => void;
  onUpload: () => void;
  onToggle: (id: string) => void;
  onDelete: (document: DocumentItem) => void;
}) {
  return (
    <section className={`panel documents-panel ${compact ? 'compact' : ''}`}>
      <div className="panel-heading">
        <div>
          <h1>Documents</h1>
          <p>{totalCount} file(s)</p>
        </div>
        {!compact && (
          <button
            className="primary-button"
            onClick={onUpload}
            disabled={uploading}
          >
            <Upload /> Upload file
          </button>
        )}
      </div>

      <label className="search-input">
        <Search />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search documents"
        />
      </label>

      {compact && (
        <button className="upload-box" onClick={onUpload} disabled={uploading}>
          {uploading ? <LoaderCircle className="spin" /> : <Upload />}
          {uploading ? 'Processing file...' : 'Upload PDF, TXT, or MD'}
        </button>
      )}

      <div className="document-list">
        {loading && (
          <div className="empty-state">
            <LoaderCircle className="spin" /> Loading documents...
          </div>
        )}

        {!loading && !documents.length && (
          <div className="empty-state">
            <FileText />
            <strong>{search ? 'No matching documents' : 'No documents yet'}</strong>
            <span>{search ? 'Try another search.' : 'Upload a file to get started.'}</span>
          </div>
        )}

        {documents.map((document) => (
          <article className="document-row" key={document.id}>
            <button
              className={`select-button ${document.selected ? 'selected' : ''}`}
              onClick={() => onToggle(document.id)}
              aria-label={`${document.selected ? 'Deselect' : 'Select'} ${document.filename}`}
            >
              {document.selected && <Check />}
            </button>
            <FileText className="document-icon" />
            <div>
              <strong title={document.filename}>{document.filename}</strong>
              <span>
                {formatSize(document.size)} · {formatDate(document.uploadedAt)}
              </span>
            </div>
            <button
              className="delete-button"
              onClick={() => onDelete(document)}
              aria-label={`Delete ${document.filename}`}
            >
              <Trash2 />
            </button>
          </article>
        ))}
      </div>

      <p className="file-help">Maximum file size: 10 MB.</p>
    </section>
  );
}

function HistoryPanel({
  history,
  documents,
  onClear,
  onAskAgain,
}: {
  history: HistoryItem[];
  documents: DocumentItem[];
  onClear: () => void;
  onAskAgain: (question: string) => void;
}) {
  const names = new Map(documents.map((document) => [document.id, document.filename]));

  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <h1>History</h1>
          <p>Your latest questions</p>
        </div>
        {!!history.length && (
          <button className="danger-button" onClick={onClear}>
            <Trash2 /> Clear history
          </button>
        )}
      </div>

      {!history.length && (
        <div className="empty-state history-empty">
          <Clock />
          <strong>No chat history</strong>
          <span>Your questions will appear here.</span>
        </div>
      )}

      <div className="history-list">
        {history.map((item) => (
          <article className="history-item" key={item.id}>
            <small>{new Date(item.createdAt).toLocaleString()}</small>
            <h2>{item.question}</h2>
            <p>{item.answer}</p>
            <div>
              {item.sourceDocumentIds
                .map((id) => names.get(id))
                .filter(Boolean)
                .map((name) => (
                  <span key={name}>{name}</span>
                ))}
              <button onClick={() => onAskAgain(item.question)}>Ask again</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
