import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/cn'
import { renderWikiLinks } from '../lib/markdown'

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-bite', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {linkChildren}
            </a>
          ),
        }}
      >
        {renderWikiLinks(children)}
      </ReactMarkdown>
    </div>
  )
}
