import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Link, Link2Off
} from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import UnderlineExt from '@tiptap/extension-underline'
import LinkExt from '@tiptap/extension-link'
import { useCallback } from 'react'

const TiptapButton = ({ onClick, isActive, children, title }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`p-1.5 rounded hover:bg-muted hover:text-foreground transition-colors ${
      isActive ? 'bg-muted text-foreground' : 'text-muted-foreground'
    }`}
  >
    {children}
  </button>
)

const EditorToolbar = ({ editor }) => {
  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)

    if (url === null) return // cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  if (!editor) return null

  return (
    <div className="relative z-10 flex flex-wrap items-center gap-1 border-b border-border bg-card p-2">
      <TiptapButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold"
      >
        <Bold className="w-4 h-4" />
      </TiptapButton>
      <TiptapButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic"
      >
        <Italic className="w-4 h-4" />
      </TiptapButton>
      <TiptapButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="Underline"
      >
        <Underline className="w-4 h-4" />
      </TiptapButton>
      <TiptapButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="Strikethrough"
      >
        <Strikethrough className="w-4 h-4" />
      </TiptapButton>
      <div className="w-px h-5 bg-border mx-1" />
      <TiptapButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="Bullet List"
      >
        <List className="w-4 h-4" />
      </TiptapButton>
      <TiptapButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="Ordered List"
      >
        <ListOrdered className="w-4 h-4" />
      </TiptapButton>
      <div className="w-px h-5 bg-border mx-1" />
      <TiptapButton onClick={setLink} isActive={editor.isActive('link')} title="Add Link">
        <Link className="w-4 h-4" />
      </TiptapButton>
      {editor.isActive('link') && (
        <TiptapButton
          onClick={() => editor.chain().focus().unsetLink().run()}
          title="Remove Link"
        >
          <Link2Off className="w-4 h-4" />
        </TiptapButton>
      )}
    </div>
  )
}

export const TiptapEditor = ({ value, onChange, placeholder, autoFocus = false, clamped = false, 'aria-label': ariaLabel = 'Message body' }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        // A reply's quote is a blockquote; disabling it made quoted mail a plain dump.
      }),
      UnderlineExt,
      LinkExt.configure({
        openOnClick: false,
        autolink: true,
      }),
    ],
    content: value,
    // 'start' lands the caret in the empty paragraph above a quote, which is where a reply
    // begins. Without it the caret sat at the end of the quoted text.
    autofocus: autoFocus ? 'start' : false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'outline-none w-full h-full text-sm text-foreground leading-relaxed',
        'aria-label': ariaLabel,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
  })

  return (
    // `h-full` here resolved to the CONTENT height inside a flex parent, so a long draft
    // grew the wrapper past the composer and painted under its bottom bar. Taking the
    // parent's height with flex-1 + min-h-0 keeps the scroll area inside the composer.
    <div className="flex min-h-0 flex-1 flex-col">
      <EditorToolbar editor={editor} />
      {/* Clicking anywhere in this area focuses the editor */}
      <div
        className="flex-1 overflow-y-auto cursor-text"
        onClick={() => editor?.chain().focus().run()}
      >
        <EditorContent
          editor={editor}
          className={`h-full [&_.ProseMirror]:p-3 [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none ${
            clamped ? 'compose-quote-clamped' : ''
          }`}
        />
      </div>
    </div>
  )
}
