import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body text-sm leading-7 text-slate-100/92">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
            >
              {linkChildren}
            </a>
          ),
          code: ({ className, children: codeChildren, ...rest }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return (
                <pre className="overflow-x-auto rounded-xl bg-slate-900/80 p-3 text-xs leading-6">
                  <code {...rest}>{codeChildren}</code>
                </pre>
              );
            }
            return (
              <code className="rounded bg-slate-900/60 px-1.5 py-0.5 text-[0.85em] text-cyan-100">
                {codeChildren}
              </code>
            );
          },
          ul: ({ children: uChildren }) => (
            <ul className="list-disc space-y-1 pl-5 marker:text-cyan-300">{uChildren}</ul>
          ),
          ol: ({ children: oChildren }) => (
            <ol className="list-decimal space-y-1 pl-5 marker:text-cyan-300">{oChildren}</ol>
          ),
          blockquote: ({ children: bChildren }) => (
            <blockquote className="border-l-4 border-cyan-300/60 bg-cyan-400/5 px-3 py-2 text-slate-200/85">
              {bChildren}
            </blockquote>
          ),
          h1: ({ children: hChildren }) => (
            <h1 className="mt-3 mb-2 text-lg font-bold text-white">{hChildren}</h1>
          ),
          h2: ({ children: hChildren }) => (
            <h2 className="mt-3 mb-2 text-base font-bold text-white">{hChildren}</h2>
          ),
          h3: ({ children: hChildren }) => (
            <h3 className="mt-3 mb-1 text-sm font-semibold text-cyan-100">{hChildren}</h3>
          ),
          table: ({ children: tChildren }) => (
            <div className="overflow-x-auto">
              <table className="my-2 w-full border-collapse text-xs">
                {tChildren}
              </table>
            </div>
          ),
          th: ({ children: tChildren }) => (
            <th className="border border-white/10 bg-white/5 px-2 py-1 text-left font-semibold">
              {tChildren}
            </th>
          ),
          td: ({ children: tChildren }) => (
            <td className="border border-white/10 px-2 py-1">{tChildren}</td>
          ),
          hr: () => <hr className="my-3 border-white/10" />,
          p: ({ children: pChildren }) => (
            <p className="my-1.5 leading-7">{pChildren}</p>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
