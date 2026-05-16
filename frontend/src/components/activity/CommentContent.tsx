import React, { useState, useEffect, useRef, type ReactNode } from 'react';
import { splitPlainTextWithUrls } from '../../utils/text';
import { cn } from '../../utils/cn';
import api from '../../services/api';
import { resolveAssetUrl } from '../../utils/assetUrl';

/** Interleaved text + files in one comment; stored as JSON in `text` after this prefix. */
export const PE_COMMENT_DOC_PREFIX = '__PE_DOC_V1__:';

export type CommentDocSegment =
  | { type: 'text'; content: string }
  | { type: 'file'; i: number };

export interface CommentDocV1 {
  v: 1;
  segments: CommentDocSegment[];
}

export interface PendingCommentFile {
  id: string;
  file: File;
  preview: string | null;
}

export type CommentDraftBlock =
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'file'; pending: PendingCommentFile };


export function isStructuredCommentText(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.startsWith(PE_COMMENT_DOC_PREFIX);
}

export function parseCommentDoc(text: string): CommentDocV1 | null {
  try {
    const doc = JSON.parse(text.slice(PE_COMMENT_DOC_PREFIX.length)) as CommentDocV1;
    if (doc?.v !== 1 || !Array.isArray(doc.segments)) return null;
    return doc;
  } catch {
    return null;
  }
}

export function getCommentSummary(text: string | null | undefined): string {
  if (!text) return '';
  if (!isStructuredCommentText(text)) return text;
  const doc = parseCommentDoc(text);
  if (!doc) return text;
  return doc.segments
    .map((s) => (s.type === 'text' ? s.content : '[File]'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Long URLs: one line, ellipsis, obvious link styling. */
const COMMENT_URL_ANCHOR_CLASS =
  'inline-block max-w-full min-w-0 align-bottom overflow-hidden text-ellipsis whitespace-nowrap text-indigo-600 dark:text-indigo-400 font-semibold underline-offset-2 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline cursor-pointer';

function renderPlainWithUrls(fragment: string, keyPrefix: string): ReactNode {
  if (!fragment) return null;
  return splitPlainTextWithUrls(fragment).map((seg, i) =>
    seg.type === 'url' ? (
      <a
        key={`${keyPrefix}-u-${i}`}
        href={seg.value}
        target="_blank"
        rel="noopener noreferrer"
        title={seg.value}
        onClick={(e) => e.stopPropagation()}
        className={COMMENT_URL_ANCHOR_CLASS}
      >
        {seg.value}
      </a>
    ) : (
      <span key={`${keyPrefix}-t-${i}`}>{seg.value}</span>
    )
  );
}

export const highlightText = (
  text: string,
  query: string,
  mentionNames: string[] = []
) => {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sortedNames = [...mentionNames]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escape);
  const namesPart = sortedNames.length ? `@(?:${sortedNames.join('|')})` : '';
  const mentionPattern = namesPart ? `(${namesPart}|@\\w+)` : `(@\\w+)`;
  const mentionRegex = new RegExp(mentionPattern, 'g');
  const isMention = (s: string) => new RegExp(`^${mentionPattern}$`).test(s);

  if (!query) {
    const parts = text.split(mentionRegex);
    return (
      <>
        {parts.map((part, i) =>
          isMention(part) ? (
            <span key={i} className="text-blue-600 dark:text-blue-400 font-bold">{part}</span>
          ) : (
            renderPlainWithUrls(part, `c-${i}`)
          )
        )}
      </>
    );
  }

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) => {
        if (part.toLowerCase() === query.toLowerCase()) {
          return <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/40 dark:text-yellow-200 rounded-sm px-0.5">{part}</mark>;
        }
        const subParts = part.split(mentionRegex);
        return (
          <span key={i}>
            {subParts.map((sub, j) =>
              isMention(sub) ? (
                <span key={j} className="text-blue-600 dark:text-blue-400 font-bold">{sub}</span>
              ) : (
                renderPlainWithUrls(sub, `cs-${i}-${j}`)
              )
            )}
          </span>
        );
      })}
    </>
  );
};

export const CommentText = React.memo(function CommentText({ text, searchQuery, mentionNames }: { text: string; searchQuery: string; mentionNames: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const pRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = pRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 2);
  }, [text, expanded]);

  return (
    <div className="overflow-hidden min-w-0 max-w-full">
      <p
        ref={pRef}
        className={`text-[14px] text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap break-words overflow-hidden min-w-0 ${!expanded ? 'line-clamp-4' : ''}`}
      >
        {highlightText(text, searchQuery, mentionNames)}
      </p>
      {(clamped || expanded) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[12px] font-bold text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 mt-1 transition-colors"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
});

export function CommentFilePreview({
  name,
  size,
  type,
  url,
  onPreview,
  onDelete,
  canDelete,
  className,
}: {
  name: string;
  size?: number;
  type?: string;
  url: string;
  onPreview?: (url: string, name: string) => void;
  onDelete?: () => void;
  canDelete?: boolean;
  className?: string;
}) {
  const isImage = type?.startsWith('image/');
  const [isDownloading, setIsDownloading] = useState(false);

  const getSameOriginDownloadUrl = (rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      if (parsed.origin !== window.location.origin && parsed.pathname.startsWith('/uploads/')) {
        return resolveAssetUrl(`${parsed.pathname}${parsed.search}`);
      }
      if (!/^https?:\/\//i.test(rawUrl)) return rawUrl;
      return parsed.toString();
    } catch {
      return resolveAssetUrl(rawUrl);
    }
  };

  const downloadFile = async () => {
    try {
      setIsDownloading(true);
      const downloadUrl = getSameOriginDownloadUrl(url);
      const res = await api.request<Blob>({
        url: downloadUrl,
        method: 'GET',
        responseType: 'blob',
        baseURL: '',
      });
      const blob = res.data;
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Download failed:', e);
    } finally {
      setIsDownloading(false);
    }
  };

  if (isImage) {
    return (
      <div className={cn('mt-3 relative group w-full max-w-[500px]', className)}>
        <button
          onClick={() => onPreview ? onPreview(url, name) : window.open(url, '_blank')}
          className="w-full text-left rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 shadow-sm transition-all hover:shadow-md hover:ring-2 hover:ring-indigo-500/20 active:scale-[0.99]"
        >
          <img
            src={url}
            alt={name}
            className="w-full h-auto max-h-[500px] object-cover transition-opacity group-hover:opacity-95"
            loading="lazy"
          />
        </button>
        <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 backdrop-blur-sm p-1 rounded-xl bg-black/10 transition-all duration-300">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadFile(); }}
            disabled={isDownloading}
            className="p-2 bg-white/90 text-gray-700 rounded-lg shadow-lg hover:bg-white transition-all hover:scale-110 active:scale-95 border border-white/70"
            title="Download image"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
          </button>
          {canDelete && (
            <button
              onClick={() => onDelete?.()}
              className="p-2 bg-rose-500 text-white rounded-lg shadow-lg hover:bg-rose-600 transition-all hover:scale-110 active:scale-95 border border-rose-400"
              title="Delete attachment"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 group', className)}>
      <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-500 shrink-0">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-gray-700 dark:text-gray-200 truncate">{name}</p>
        {size && <p className="text-[10px] text-gray-400 font-medium">{(size / 1024).toFixed(1)} KB</p>}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={downloadFile} disabled={isDownloading} className="p-2 text-gray-400 hover:text-indigo-500 transition-colors" title="Download file"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg></button>
        {canDelete && (
          <button onClick={() => onDelete?.()} className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Delete file"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 12-2h4a2 2 0 0 12 2v2" /></svg></button>
        )}
      </div>
    </div>
  );
}

export const CommentStructuredBody = React.memo(function CommentStructuredBody({
  doc,
  files,
  searchQuery,
  mentionNames,
  onPreview,
  onDeleteFile,
  canDelete,
}: {
  doc: CommentDocV1;
  files: any[];
  searchQuery: string;
  mentionNames: string[];
  onPreview: (url: string, name: string) => void;
  onDeleteFile: (fileUrl: string, fileName?: string) => void;
  canDelete: boolean;
}) {
  return (
    <div className="space-y-3 min-w-0 max-w-full">
      {doc.segments.map((seg, idx) => {
        if (seg.type === 'text') {
          if (!seg.content.trim()) return null;
          return <CommentText key={`doc-${idx}`} text={seg.content} searchQuery={searchQuery} mentionNames={mentionNames} />;
        }
        const att = files[seg.i];
        if (!att?.fileUrl) return null;
        return (
          <CommentFilePreview
            key={`doc-${idx}-f`}
            className="!mt-0"
            name={att.fileName || 'file'}
            size={att.fileSize}
            type={att.fileType}
            url={att.fileUrl}
            onPreview={onPreview}
            onDelete={() => onDeleteFile(att.fileUrl, att.fileName)}
            canDelete={canDelete}
          />
        );
      })}
    </div>
  );
});
