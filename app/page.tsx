'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthGate } from '@/components/auth-gate';
import { api } from '@/lib/supabase-browser';
import {
  AlertCircle,
  Check,
  Clock,
  Download,
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

function AnswerText({ text }: { text: string }) {
  const sections = text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    <div className="answer-content">
      {sections.map((section, index) => {
        const lines = section
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const heading = lines[0]?.replace(/^#+\s*/, '');
        const isSource = /^\[.+\]$/.test(heading || '');
        const isPassageTitle = /^Document passages(?:\s*\(.*\))?:?$/i.test(
          heading || '',
        );
        const body = isSource || isPassageTitle ? lines.slice(1) : lines;
        const isList =
          body.length > 0 && body.every((line) => /^[-*•]\s+/.test(line));
        const isNumbered =
          body.length > 0 && body.every((line) => /^\d+[.)]\s+/.test(line));
        const renderInline = (value: string) =>
          value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, partIndex) => {
            if (part.startsWith('**') && part.endsWith('**'))
              return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
            if (part.startsWith('`') && part.endsWith('`'))
              return <code key={partIndex}>{part.slice(1, -1)}</code>;
            return part.replace(/\[(?:Source:?\s*)?([^\]]+)\]/gi, '$1');
          });
        return (
          <section
            className={isSource ? 'answer-source' : 'answer-section'}
            key={`${index}-${section.slice(0, 20)}`}
          >
            {heading &&
              (isSource || isPassageTitle || section.includes('\n')) && (
                <h3>
                  {isSource ? heading.slice(1, -1) : heading.replace(/:$/, '')}
                </h3>
              )}
            {!body.length ? null : isList ? (
              <ul>
                {body.map((line) => (
                  <li key={line}>
                    {renderInline(line.replace(/^[-*•]\s+/, ''))}
                  </li>
                ))}
              </ul>
            ) : isNumbered ? (
              <ol>
                {body.map((line) => (
                  <li key={line}>
                    {renderInline(line.replace(/^\d+[.)]\s+/, ''))}
                  </li>
                ))}
              </ol>
            ) : (
              <p>{renderInline(body.join(' '))}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

async function extractText(file: File) {
  if (!/\.pdf$/i.test(file.name)) return file.text();

  const pdfjs = await import('pdfjs-dist');
  // Served untouched from public: Vite's dev transforms inject window-based
  // client code into dependency URLs, which cannot run inside a PDF worker.
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise;
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

export default function Home() {
  return (
    <AuthGate>
      <Workspace />
    </AuthGate>
  );
}

function Workspace() {
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
  const messageEndRef = useRef<HTMLDivElement>(null);

  const selectedDocuments = documents.filter((document) => document.selected);
  const visibleDocuments = useMemo(
    () =>
      documents.filter((document) =>
        document.filename.toLowerCase().includes(search.toLowerCase()),
      ),
    [documents, search],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<{ documents: Omit<DocumentItem, 'selected'>[] }>('/api/documents'),
      api<{ history: HistoryItem[] }>('/api/chat/history'),
    ])
      .then(([documentData, historyData]) => {
        if (!active) return;
        setDocuments(
          documentData.documents.map((document) => ({
            ...document,
            selected: true,
          })),
        );
        setHistory(historyData.history);
        const names = new Map(
          documentData.documents.map((document) => [
            document.id,
            document.filename,
          ]),
        );
        const restoredMessages: Message[] = historyData.history
          .slice()
          .reverse()
          .flatMap((item) => [
            { role: 'user' as const, text: item.question },
            {
              role: 'assistant' as const,
              text: item.answer,
              sources: item.sourceDocumentIds
                .map((id) => names.get(id))
                .filter((name): name is string => Boolean(name)),
              mode: 'gemini' as const,
            },
          ]);
        setMessages(
          restoredMessages.length
            ? restoredMessages
            : [
                {
                  role: 'assistant',
                  text: 'Add a document and ask a question about it.',
                },
              ],
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNotice({
          type: 'error',
          text:
            error instanceof Error ? error.message : 'Could not load the app.',
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, answering]);

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

    try {
      await api(`/api/documents/${encodeURIComponent(document.id)}`, {
        method: 'DELETE',
      });
      setDocuments((current) =>
        current.filter((item) => item.id !== document.id),
      );
      setNotice({ type: 'success', text: 'Document deleted.' });
    } catch (error) {
      setNotice({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Could not delete the document.',
      });
    }
  }

  async function downloadDocument(document: DocumentItem) {
    try {
      const result = await api<{ url: string }>(
        `/api/documents/${encodeURIComponent(document.id)}`,
      );
      window.location.assign(result.url);
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Download failed.',
      });
    }
  }

  async function askQuestion(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = question.trim();
    if (!value || answering) return;

    if (!selectedDocuments.length) {
      setNotice({ type: 'error', text: 'Select at least one document first.' });
      return;
    }
    if (selectedDocuments.length > 20) {
      setNotice({
        type: 'error',
        text: 'Select up to 20 documents per question.',
      });
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
        warning?: string;
        historySaved: boolean;
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

      if (result.warning) setNotice({ type: 'error', text: result.warning });
      if (result.historySaved) {
        try {
          const historyData = await api<{ history: HistoryItem[] }>(
            '/api/chat/history',
          );
          setHistory(historyData.history);
        } catch {
          setNotice({
            type: 'error',
            text: [
              result.warning,
              'Your answer is shown, but the history list could not be refreshed.',
            ]
              .filter(Boolean)
              .join(' '),
          });
        }
      }
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
        text:
          error instanceof Error ? error.message : 'Could not clear history.',
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
        <output className={`notice ${notice.type}`}>
          {notice.type === 'error' ? <AlertCircle /> : <Check />}
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X />
          </button>
        </output>
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
              onDownload={(document) => void downloadDocument(document)}
            />

            <section className="panel chat-panel" aria-label="Document chat">
              <div className="panel-heading">
                <div>
                  <h1>Chat</h1>
                  <p>{selectedDocuments.length} document(s) selected</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setView('documents')}
                >
                  Manage documents
                </button>
              </div>

              <div className="message-list">
                {messages.map((message, index) => (
                  <article className={`message ${message.role}`} key={index}>
                    <strong>{message.role === 'user' ? 'You' : 'askAI'}</strong>
                    <div>
                      <AnswerText text={message.text} />
                      {!!message.sources?.length && (
                        <div className="source-list">
                          {message.sources.map((source) => (
                            <span key={source}>{source}</span>
                          ))}
                          <span>
                            {message.mode === 'gemini'
                              ? 'Gemini'
                              : 'Local search'}
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
                <div ref={messageEndRef} aria-hidden="true" />
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
            onDownload={(document) => void downloadDocument(document)}
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
  onDownload,
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
  onDownload: (document: DocumentItem) => void;
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
            <strong>
              {search ? 'No matching documents' : 'No documents yet'}
            </strong>
            <span>
              {search ? 'Try another search.' : 'Upload a file to get started.'}
            </span>
          </div>
        )}

        {documents.map((document) => (
          <article className="document-row" key={document.id}>
            <button
              className={`select-button ${document.selected ? 'selected' : ''}`}
              onClick={() => onToggle(document.id)}
              aria-label={`${document.selected ? 'Deselect' : 'Select'} ${document.filename}`}
              aria-pressed={document.selected}
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
              onClick={() => onDownload(document)}
              aria-label={`Download ${document.filename}`}
            >
              <Download />
            </button>
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

      <p className="file-help">
        Up to 10 MB and 400,000 text characters per file. Select up to 20 files
        per question.
      </p>
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
  const names = new Map(
    documents.map((document) => [document.id, document.filename]),
  );

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
              <button onClick={() => onAskAgain(item.question)}>
                Ask again
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
