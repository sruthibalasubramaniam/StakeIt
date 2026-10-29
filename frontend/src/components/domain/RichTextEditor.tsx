import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import { MaterialIcon } from '../ui/core';

/**
 * Rich-text editor for reading sections.
 *
 * Deliberately dependency-free: a `contentEditable` surface plus the browser's
 * editing commands. The HTML it produces is **not** trusted — the API sanitises
 * every section through an allow-list before storing it, so nothing here needs
 * to be a security boundary. The HTML view exists because pasting existing
 * material is a common authoring path and a textarea is the honest way to do it.
 *
 * Keyboard: every control is a real button, so toolbar actions are reachable by
 * tab order; `aria-pressed` reflects the current selection's formatting.
 */

type ToolbarAction =
  | { kind: 'command'; command: string; value?: string; icon: string; label: string }
  | { kind: 'block'; block: 'h2' | 'h3' | 'p' | 'pre' | 'blockquote'; icon: string; label: string }
  | { kind: 'link' | 'image' | 'table' | 'code'; icon: string; label: string };

const TOOLBAR: Array<Array<ToolbarAction>> = [
  [
    { kind: 'block', block: 'h2', icon: 'title', label: 'Heading 2' },
    { kind: 'block', block: 'h3', icon: 'format_size', label: 'Heading 3' },
    { kind: 'block', block: 'p', icon: 'notes', label: 'Paragraph' },
  ],
  [
    { kind: 'command', command: 'bold', icon: 'format_bold', label: 'Bold' },
    { kind: 'command', command: 'italic', icon: 'format_italic', label: 'Italic' },
    { kind: 'command', command: 'underline', icon: 'format_underlined', label: 'Underline' },
    { kind: 'code', icon: 'code', label: 'Inline code' },
  ],
  [
    { kind: 'command', command: 'insertUnorderedList', icon: 'format_list_bulleted', label: 'Bulleted list' },
    { kind: 'command', command: 'insertOrderedList', icon: 'format_list_numbered', label: 'Numbered list' },
    { kind: 'block', block: 'blockquote', icon: 'format_quote', label: 'Quote' },
    { kind: 'block', block: 'pre', icon: 'data_object', label: 'Code block' },
  ],
  [
    { kind: 'link', icon: 'link', label: 'Insert link' },
    { kind: 'image', icon: 'image', label: 'Insert image by URL' },
    { kind: 'table', icon: 'table', label: 'Insert table' },
  ],
];

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write the section content…',
  minHeight,
  label,
  hint,
  disabled = false,
  error,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  label?: string;
  hint?: string;
  disabled?: boolean;
  error?: string | null;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [linkError, setLinkError] = useState<string | null>(null);
  /*
   * `null`, not `value`: seeding the ref with the initial value made the sync
   * below skip its first run, so a section that already had a body rendered as an
   * empty editor — the content existed on the server but never reached the
   * contentEditable. Anything that reads as "unchanged" on mount hides this class
   * of bug, so the sentinel is deliberate.
   */
  const lastValue = useRef<string | null>(null);

  /**
   * Hydrate and re-sync the surface.
   *
   * A layout effect, not a passive one: it must land after the DOM node exists
   * but before the browser can deliver focus/blur events. With a passive effect a
   * blur could fire first, `emit('')` would push an empty body into the parent,
   * and the section would look empty *and* dirty — which is exactly what
   * happened.
   *
   * The `innerHTML === value` check is what allows this to run on every value
   * change without disturbing the caret: while the instructor types, the DOM is
   * already the source of that value, so the write is skipped.
   */
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (document.activeElement === surface) return;
    if (surface.innerHTML === value) {
      lastValue.current = value;
      return;
    }
    surface.innerHTML = value;
    lastValue.current = value;
  }, [value, mode]);

  const emit = (html: string) => {
    lastValue.current = html;
    onChange(html);
  };

  const exec = (command: string, argument?: string) => {
    if (disabled) return;
    surfaceRef.current?.focus();
    document.execCommand(command, false, argument);
    if (surfaceRef.current) emit(surfaceRef.current.innerHTML);
  };

  const applyBlock = (block: ToolbarAction & { kind: 'block' }) => {
    // `formatBlock` expects an element name; browsers normalise it themselves.
    exec('formatBlock', block.block === 'p' ? 'p' : `<${block.block}>`);
  };

  const insertLink = () => {
    const url = window.prompt('Link URL (https://…)');
    if (!url) return;
    if (!isHttpUrl(url)) {
      setLinkError('Only http and https links can be inserted.');
      return;
    }
    setLinkError(null);
    exec('createLink', url);
  };

  const insertImage = () => {
    const url = window.prompt('Image URL (https://…)');
    if (!url) return;
    if (!isHttpUrl(url)) {
      setLinkError('Only http and https image URLs can be inserted.');
      return;
    }
    setLinkError(null);
    exec('insertImage', url);
  };

  const insertTable = () => {
    exec(
      'insertHTML',
      '<table><thead><tr><th>Column</th><th>Column</th></tr></thead><tbody><tr><td></td><td></td></tr><tr><td></td><td></td></tr></tbody></table><p></p>',
    );
  };

  const wrapCode = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setLinkError('Select some text first, then apply inline code.');
      return;
    }
    setLinkError(null);
    exec('insertHTML', `<code>${selection.toString()}</code>`);
  };

  const handleAction = (action: ToolbarAction) => {
    switch (action.kind) {
      case 'command':
        exec(action.command, action.value);
        return;
      case 'block':
        applyBlock(action);
        return;
      case 'link':
        insertLink();
        return;
      case 'image':
        insertImage();
        return;
      case 'table':
        insertTable();
        return;
      case 'code':
        wrapCode();
        return;
      default:
        return;
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <div className="flex items-center justify-between gap-space-sm">
          <span className="font-label-sm text-label-sm text-on-surface">{label}</span>
          <button
            type="button"
            className="font-label-xs text-label-xs text-primary hover:underline"
            onClick={() => setMode((current) => (current === 'visual' ? 'html' : 'visual'))}
          >
            {mode === 'visual' ? 'Edit HTML' : 'Visual editor'}
          </button>
        </div>
      ) : null}

      {mode === 'visual' ? (
        <div
          className={cn(
            'rounded border border-outline-variant bg-surface-container-lowest',
            error && 'border-error',
            disabled && 'opacity-60',
          )}
        >
          <div className="flex flex-wrap items-center gap-0.5 border-b border-outline-variant px-1 py-1" role="toolbar" aria-label="Formatting">
            {TOOLBAR.map((group, groupIndex) => (
              <div key={groupIndex} className="flex items-center gap-0.5 border-r border-outline-variant pr-1 last:border-r-0">
                {group.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    title={action.label}
                    aria-label={action.label}
                    disabled={disabled}
                    // The surface keeps focus so the selection survives the click.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleAction(action)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface disabled:opacity-40"
                  >
                    <MaterialIcon name={action.icon} className="text-[16px]" />
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div
            ref={surfaceRef}
            role="textbox"
            aria-multiline="true"
            aria-label={label ?? 'Section content'}
            aria-disabled={disabled}
            contentEditable={!disabled}
            suppressContentEditableWarning
            data-placeholder={placeholder}
            className="reading-prose reading-editor-surface border-0"
            style={minHeight ? { minHeight } : undefined}
            onInput={(event) => emit((event.target as HTMLDivElement).innerHTML)}
            onBlur={(event) => emit((event.target as HTMLDivElement).innerHTML)}
            onPaste={(event) => {
              /*
               * Paste as plain text: copying from a word processor drags in
               * fonts, colours and classes that the API would strip anyway.
               * Plain text keeps the result predictable.
               */
              const text = event.clipboardData.getData('text/plain');
              if (!text) return;
              event.preventDefault();
              document.execCommand('insertText', false, text);
              if (surfaceRef.current) emit(surfaceRef.current.innerHTML);
            }}
          />
        </div>
      ) : (
        <textarea
          value={value}
          onChange={(event) => emit(event.target.value)}
          rows={12}
          spellCheck={false}
          disabled={disabled}
          aria-label="Section HTML"
          className="w-full rounded border border-outline-variant bg-surface-container-lowest px-space-md py-space-sm font-mono text-[12px] leading-relaxed text-on-surface focus:border-primary-container focus:outline-none focus:ring-2 focus:ring-primary-container/10"
        />
      )}

      {error ? (
        <p className="flex items-center gap-1 font-body-sm text-body-sm text-error">
          <MaterialIcon name="error" className="text-[14px]" />
          {error}
        </p>
      ) : linkError ? (
        <p className="font-body-sm text-body-sm text-error">{linkError}</p>
      ) : hint ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{hint}</p>
      ) : null}
    </div>
  );
}
