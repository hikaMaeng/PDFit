import { memo, useId } from 'react';
import Typography from '@mui/material/Typography';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { COMMENT } from './resource.js';

const remarkPlugins = [remarkGfm, remarkBreaks];

// See docs/usage.md#book-comments-markdown.
export const BookCommentMarkdown = memo(function BookCommentMarkdown({ body }: { body: string }) {
  const { t } = usePdfitI18n();
  const prefix = `comment-${useId()}-`;
  const footnoteLabelId = `${prefix}footnote-label`;

  return <Typography component="div" sx={{
    mt: .5,
    minWidth: 0,
    overflowWrap: 'anywhere',
    '& > :first-child': { mt: 0 },
    '& > :last-child': { mb: 0 },
    '& p, & ul, & ol, & blockquote, & pre': { my: 1 },
    '& ul, & ol': { paddingInlineStart: '1.75em' },
    '& ul.contains-task-list': { listStyle: 'none' },
    '& h1, & h2': { my: 1, fontSize: '1.25em', lineHeight: 1.35 },
    '& h3, & h4, & h5, & h6': { my: 1, fontSize: '1em', lineHeight: 1.4 },
    '& a[href]': { color: 'primary.main' },
    '& img': { maxWidth: '100%', height: 'auto', verticalAlign: 'middle' },
    '& blockquote': { mx: 0, paddingInlineStart: '0.75em', borderInlineStart: '3px solid', borderColor: 'divider', color: 'text.secondary' },
    '& code, & pre': { bgcolor: 'action.hover', borderRadius: 1 },
    '& :not(pre) > code': { px: .5 },
    '& pre': { p: 1, overflowX: 'auto' },
    '& pre > code': { bgcolor: 'transparent', overflowWrap: 'normal' },
    '& .comment-markdown-table': { my: 1, overflowX: 'auto' },
    '& table': { borderCollapse: 'collapse' },
    '& th, & td': { border: '1px solid', borderColor: 'divider', px: 1, py: .5 },
    '& th': { bgcolor: 'action.hover' },
    '& hr': { border: 0, borderTop: '1px solid', borderColor: 'divider' },
    '& .footnotes': { mt: 2, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.875em' },
  }}>
    <Markdown remarkPlugins={remarkPlugins} remarkRehypeOptions={{
      clobberPrefix: prefix,
      footnoteLabel: t(COMMENT.FOOTNOTES),
      footnoteLabelProperties: {},
      footnoteBackLabel: (index, occurrence) => t(COMMENT.FOOTNOTE_BACK, {
        reference: occurrence > 1 ? `${index}.${occurrence}` : index,
      }),
    }} components={{
      // The generated heading ID and its label reference use a fixed ID upstream.
      h2: ({ node: _node, id, ...props }) => <h2 {...props} id={id === 'footnote-label' ? footnoteLabelId : id} />,
      a: ({ node: _node, href, 'aria-describedby': describedBy, ...props }) => <a {...props}
        href={href || undefined} aria-describedby={describedBy === 'footnote-label' ? footnoteLabelId : describedBy} />,
      img: ({ node: _node, src, alt, ...props }) => src
        ? <img {...props} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />
        : <>{alt}</>,
      table: ({ node: _node, ...props }) => <div className="comment-markdown-table"><table {...props} /></div>,
    }}>{body}</Markdown>
  </Typography>;
});
